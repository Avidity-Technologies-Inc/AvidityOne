import { DeviceQueryDto } from "./dto/device-query.dto";

export interface InventoryDevice {
  id: string;
  name: string;
  hostname: string | null;
  deviceGroupId: string | null;
  operatingSystem: string | null;
  osVersion: string | null;
  primaryUser: string | null;
  remoteAccessId: string | null;
  serialNumber: string | null;
  assetTag: string | null;
  status: string;
  type: string;
  client: { name: string; shortName: string | null };
  favorites: Array<{ userId: string }>;
  remoteAccessProfile: { detailSnapshot: unknown } | null;
}

export function inventoryNetwork(device: InventoryDevice): string[] {
  const snapshot = device.remoteAccessProfile?.detailSnapshot as { network?: { localIps?: unknown; publicIp?: unknown; macAddresses?: unknown } } | null;
  const network = snapshot?.network;
  return [network?.publicIp, ...(Array.isArray(network?.localIps) ? network.localIps : []), ...(Array.isArray(network?.macAddresses) ? network.macAddresses : [])]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
}

export function inventoryMatches(device: InventoryDevice, search: string) {
  const needle = search.trim().toLowerCase();
  return [device.name, device.hostname, device.deviceGroupId, device.operatingSystem, device.osVersion,
    device.primaryUser, device.remoteAccessId, device.serialNumber, device.assetTag, device.client.name,
    device.client.shortName, ...inventoryNetwork(device)]
    .some(value => value?.toLowerCase().includes(needle));
}

export function inventoryIsServer(device: InventoryDevice) {
  // Keep existing inventory category behavior, including RMM records with generic types.
  if (device.type === "SERVER") return true;
  const source = `${device.type} ${device.name} ${device.operatingSystem ?? ""}`.toLowerCase();
  if (source.includes("server")) return true;
  if (["laptop", "notebook", "tablet", "ios", "android"].some(value => source.includes(value))) return false;
  return ["linux", "ubuntu", "debian", "centos", "red hat", "rhel", "rocky", "alma", "fedora", "suse", "pve", "proxmox", "esxi"].some(value => source.includes(value))
    && !["desktop", "workstation", "laptop", "notebook", "tablet", "phone"].some(value => source.includes(value));
}

export function selectInventory<T extends InventoryDevice>(devices: T[], query: DeviceQueryDto) {
  const filtered = devices.filter(device => !query.search?.trim() || inventoryMatches(device, query.search));
  const counts = {
    all: filtered.length,
    servers: filtered.filter(inventoryIsServer).length,
    workstations: filtered.filter(device => ["DESKTOP", "LAPTOP"].includes(device.type)).length
  };
  const selected = filtered.filter(device => query.deviceTab === "servers" ? inventoryIsServer(device)
    : query.deviceTab === "workstations" ? ["DESKTOP", "LAPTOP"].includes(device.type) : true);
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const compare = (left: string | null, right: string | null) => {
    // Missing values stay last in either direction.
    if (!left || !right) return !left && !right ? 0 : !left ? 1 : -1;
    return collator.compare(left, right) * (query.sortDirection === "desc" ? -1 : 1);
  };
  selected.sort((left, right) => {
    const favoriteOrder = query.favoritesFirst === "false" ? 0 : Number(right.favorites.length > 0) - Number(left.favorites.length > 0);
    if (favoriteOrder) return favoriteOrder;
    let order = 0;
    switch (query.sortBy ?? "client") {
      case "name": order = compare(left.name, right.name); break;
      case "client": order = compare(left.client.name, right.client.name) || compare(left.deviceGroupId, right.deviceGroupId); break;
      case "site": order = compare(left.deviceGroupId, right.deviceGroupId) || compare(left.client.name, right.client.name); break;
      case "os": order = compare(left.operatingSystem, right.operatingSystem) || compare(left.osVersion, right.osVersion); break;
      case "status": order = compare(left.status, right.status); break;
    }
    return order || compare(left.name, right.name) || collator.compare(left.id, right.id);
  });
  return { selected, counts };
}
