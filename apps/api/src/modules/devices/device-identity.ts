// Only system-level hardware identifiers are evidence of equipment identity.
// OS licenses, disk/RAM serials, agent IDs and names must never become a UUID.
export interface HardwareIdentity {
  serialNumber: string | null;
  hardwareUuid: string | null;
  manufacturer: string | null;
  model: string | null;
}

const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
function records(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.flatMap(records) : v && typeof v === "object" ? [object(v)] : [];
}
export function identityText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ").toUpperCase();
  if (!text || /^(UNKNOWN.*|DEFAULT STRING|TO BE FILLED.*|NOT (SPECIFIED|AVAILABLE|APPLICABLE)|NONE|N\/A|OEM|SYSTEM SERIAL NUMBER|0+|F+|123456789|1234567890)$/.test(text)) return null;
  return text;
}
export function extractHardwareIdentity(raw: Record<string, unknown>): HardwareIdentity {
  const wmi = object(raw.wmi_detail ?? raw.wmiDetail ?? raw.wmi);
  const hw = object(raw.hardware ?? raw.hardware_details ?? raw.system);
  const bios = records(wmi.bios)[0] ?? {};
  const system = records(wmi.comp_sys ?? wmi.computer_system)[0] ?? {};
  const product = records(wmi.comp_sys_prod ?? wmi.computer_system_product)[0] ?? {};
  const first = (...values: unknown[]) => values.map(identityText).find(Boolean) ?? null;
  const serialNumber = first(raw.serial_number, raw.serialNumber, raw.serial, hw.serialNumber, hw.serial_number, wmi.serialnumber, bios.SerialNumber);
  const uuid = first(raw.hardware_uuid, raw.hardwareUuid, raw.system_uuid, hw.uuid, hw.hardwareUuid, wmi.hardware_uuid, wmi.platform_uuid, product.UUID);
  const hardwareUuid = uuid && /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(uuid) && !/^(0|-)+$/.test(uuid) && !/^(F|-)+$/.test(uuid) ? uuid : null;
  const model = first(system.Model, hw.model, raw.model, raw.make_model, wmi.make_model);
  const manufacturer = first(system.Manufacturer, raw.manufacturer, raw.make, hw.manufacturer, hw.make,
    model && /^(MAC|IMAC)/.test(model) ? "APPLE" : null);
  return { serialNumber, hardwareUuid, manufacturer, model };
}

export function compareHardware(a: HardwareIdentity, b: HardwareIdentity): "strong" | "conflict" | "unknown" {
  if ((a.serialNumber && b.serialNumber && a.serialNumber !== b.serialNumber) ||
      (a.hardwareUuid && b.hardwareUuid && a.hardwareUuid !== b.hardwareUuid)) return "conflict";
  const serial = Boolean(a.serialNumber && a.serialNumber === b.serialNumber);
  const uuid = Boolean(a.hardwareUuid && a.hardwareUuid === b.hardwareUuid);
  const model = Boolean(a.model && a.model === b.model);
  const maker = Boolean(a.manufacturer && a.manufacturer === b.manufacturer);
  // Cloned VMs and generic vendor serials need operator review even if they match.
  const virtual = /VMWARE|VIRTUAL|KVM|QEMU|PARALLELS|XEN/.test(`${a.model} ${b.model} ${a.manufacturer} ${b.manufacturer}`);
  return !virtual && ((serial && uuid) || (serial && maker && model)) ? "strong" : "unknown";
}

export function identityMacs(snapshot: unknown): string[] {
  const details = object(object(snapshot).detailSnapshot);
  const addresses = object(details.network).macAddresses;
  if (!Array.isArray(addresses)) return [];
  return addresses.flatMap(value => {
    if (typeof value !== "string") return [];
    const mac = value.replace(/[:-]/g, "").toUpperCase();
    // Multicast, private/randomized and placeholder addresses are not useful evidence.
    return /^[0-9A-F]{12}$/.test(mac) && !/^0+$/.test(mac) && (parseInt(mac.slice(0,2),16) & 3) === 0 ? [mac] : [];
  });
}

export function identityCandidate(a: HardwareIdentity & { hostname: string; snapshot?: unknown }, b: HardwareIdentity & { hostname: string; snapshot?: unknown }): boolean {
  return Boolean((a.serialNumber && a.serialNumber === b.serialNumber) ||
    (a.hardwareUuid && a.hardwareUuid === b.hardwareUuid) ||
    a.hostname.toLowerCase() === b.hostname.toLowerCase() || identityMacs(a.snapshot).some(mac=>identityMacs(b.snapshot).includes(mac)));
}
