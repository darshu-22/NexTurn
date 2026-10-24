"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import QRScannerModal from "../components/QRScannerModal";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export default function UserDashboard() {
  const [user, setUser] = useState<any>(null);
  const [activeEntries, setActiveEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMsg, setLoadingMsg] = useState("Loading your queues…");
  const [isScannerOpen, setIsScannerOpen] = useState(false);
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

    if (role === "ADMIN") {
      router.push("/admin/dashboard");
      return;
    }

    fetchUserData(token);
  }, []);

  const fetchUserData = async (token: string) => {
    setError(null);
    setLoading(true);
    setLoadingMsg("Loading your queues…");

    const timer1 = setTimeout(() => setLoadingMsg("Connecting to NexTurn…"), 3000);
    const timer2 = setTimeout(() => setLoadingMsg("NexTurn is waking up. This may take a few seconds…"), 7000);

    try {
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

      if (!entriesRes.ok) {
        const errData = await entriesRes.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to load active queues");
      }

      const entriesData = await entriesRes.json();
      setActiveEntries(entriesData || []);
    } catch (err: any) {
      console.error(err);
      if (err.name === "TypeError" || err.message?.includes("fetch")) {
        setError("Unable to connect to NexTurn. Please check your connection and try again.");
      } else {
        setError(err.message || "Failed to load dashboard data.");
      }
    } finally {
      clearTimeout(timer1);
      clearTimeout(timer2);
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("user");
    router.push("/login");
  };

  const handleScanSuccess = (queueId: string) => {
    setIsScannerOpen(false);
    router.push(`/queue/${queueId}`);
  };

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
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-800/50 rounded-full">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </span>
            </div>
            <p className="text-slate-400 text-sm mt-1">
              {user?.email} {user?.phone ? `• ${user.phone}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsScannerOpen(true)}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition flex items-center gap-2 shadow-lg shadow-blue-600/20"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v1m0 14v1m8-8h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
              Scan QR Code
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium rounded-xl transition"
            >
              Log Out
            </button>
          </div>
        </div>

        {/* Joined Queues */}
        <div className="p-6 bg-slate-800 border border-slate-700 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">Your Active Queues</h2>
            <button
              onClick={() => setIsScannerOpen(true)}
              className="text-xs text-blue-400 hover:underline font-medium"
            >
              + Join another queue
            </button>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
              <p className="text-slate-400 text-sm">{loadingMsg}</p>
            </div>
          ) : error ? (
            <div className="p-4 border border-rose-800/60 bg-rose-950/40 rounded-xl space-y-3 text-center">
              <p className="text-sm text-rose-300">{error}</p>
              <button
                onClick={() => {
                  const token = localStorage.getItem("token");
                  if (token) fetchUserData(token);
                }}
                className="px-4 py-1.5 text-xs bg-rose-900/60 hover:bg-rose-800/80 text-rose-100 font-medium rounded-lg transition"
              >
                Try Again
              </button>
            </div>
          ) : activeEntries.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-slate-700 rounded-xl space-y-4">
              <div>
                <p className="text-slate-400 text-sm mb-1">
                  You are not currently in any queues.
                </p>
                <p className="text-xs text-slate-500">
                  Scan an organization's QR code or open a public queue link to
                  join.
                </p>
              </div>
              <button
                onClick={() => setIsScannerOpen(true)}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm rounded-xl transition inline-flex items-center gap-2"
              >
                Scan QR Code Now
              </button>
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

      {/* QR Scanner Modal */}
      <QRScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleScanSuccess}
      />
    </div>
  );
}
