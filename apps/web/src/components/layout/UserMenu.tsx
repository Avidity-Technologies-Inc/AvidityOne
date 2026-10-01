"use client";

import { ChevronDown, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

interface CurrentUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  permissions: string[];
}

interface CurrentUserResponse {
  user: CurrentUser;
}

function initialsFor(user: CurrentUser | null) {
  if (!user) {
    return "?";
  }

  return `${user.firstName.slice(0, 1)}${user.lastName.slice(0, 1)}`.toUpperCase();
}

export function UserMenu({ user: providedUser }: { user?: CurrentUser | null }) {
  const [user, setUser] = useState<CurrentUser | null>(providedUser ?? null);
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;

    if (providedUser !== undefined) {
      setUser(providedUser);
      return () => {
        mounted = false;
      };
    }

    apiFetch<CurrentUserResponse>("/auth/me")
      .then((response) => {
        if (mounted) {
          setUser(response.user);
        }
      })
      .catch(() => {
        window.location.assign("/login");
      });

    return () => {
      mounted = false;
    };
  }, [providedUser]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  async function logout() {
    setLoggingOut(true);

    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        className="user-menu-trigger"
        type="button"
        aria-label="User menu"
        title={user ? `${user.firstName} ${user.lastName}` : "User menu"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="user-avatar">{initialsFor(user)}</span>
        <span className="user-summary">
          <strong>{user ? `${user.firstName} ${user.lastName}` : "Profile"}</strong>
          <span>{user?.email ?? "Loading..."}</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>

      {open ? (
        <div className="user-menu-panel" role="menu">
          <div className="user-menu-header">
            <UserRound size={18} aria-hidden="true" />
            <div>
              <strong>{user ? `${user.firstName} ${user.lastName}` : "Profile"}</strong>
              <span>{user?.email ?? ""}</span>
            </div>
          </div>
          <Link className="user-menu-item neutral" href="/profile" role="menuitem" onClick={() => setOpen(false)}>
            <UserRound size={16} aria-hidden="true" />
            <span>Profile</span>
          </Link>
          <button className="user-menu-item" type="button" role="menuitem" onClick={logout} disabled={loggingOut}>
            <LogOut size={16} aria-hidden="true" />
            <span>{loggingOut ? "Signing out" : "Sign out"}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
