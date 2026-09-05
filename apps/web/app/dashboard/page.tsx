"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export default function UserDashboard() {
  const [user, setUser] = useState<any>(null);
  const [activeEntries, setActiveEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("token");
    const role = localStorage.getItem("role");

    if (!token) {
      router.push("/login");
      return;
    }

    if (role === "SUPER_ADMIN") {
      router.push("/super-admin");
      return;
    }

    if (role === "ADMIN" || role === "ORGANIZATION_ADMIN") {
      router.push("/admin/dashboard");
      return;
    }

    fetchUserData(token);
  }, []);

  const fetchUserData = async (token: string) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
      }

      // Fetch user's active queue entries
      const entriesRes = await fetch(`${API_BASE}/user/entries`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (entriesRes.ok) {
        const entriesData = await entriesRes.json();
        setActiveEntries(entriesData || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("user");
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-800 border border-slate-700 rounded-2xl">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">
                Welcome, {user?.name || "Customer"}
              </h1>
              <span className="px-2.5 py-0.5 text-xs font-semibold bg-blue-900/60 text-blue-300 border border-blue-700/50 rounded-full">
                USER
              </span>
            </div>
            <p className="text-slate-400 text-sm mt-1">
              {user?.email} {user?.phone ? `• ${user.phone}` : ""}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="self-start md:self-auto px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium rounded-xl transition"
          >
            Log Out
          </button>
        </div>

        {/* Joined Queues */}
        <div className="p-6 bg-slate-800 border border-slate-700 rounded-2xl space-y-4">
          <h2 className="text-lg font-bold text-white">Your Active Queues</h2>

          {activeEntries.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-slate-700 rounded-xl">
              <p className="text-slate-400 text-sm mb-3">
                You are not currently in any queues.
              </p>
              <p className="text-xs text-slate-500">
                Scan an organization's QR code or open a public queue link to
                join.
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {activeEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between p-4 bg-slate-900/80 border border-slate-700 rounded-xl"
                >
                  <div>
                    <h3 className="font-semibold text-white">
                      {entry.queue?.name || "Queue"}
                    </h3>
                    <p className="text-xs text-slate-400">
                      Position #{entry.position} • Status: {entry.status}
                    </p>
                  </div>
                  <Link
                    href={`/queue/${entry.queueId}`}
                    className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl transition"
                  >
                    View Status
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
