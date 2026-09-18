const router = { replace() {}, push() {}, refresh() {} };
export function useRouter() { return router; }
export function usePathname() { return window.location.pathname; }
