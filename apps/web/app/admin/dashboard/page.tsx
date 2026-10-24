"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { io, Socket } from "socket.io-client";
import { QRCodeSVG } from "qrcode.react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000";

interface Queue {
  id: string;
  name: string;
  status: string;
  joinEnabled: boolean;
}

interface QueueEntry {
  id: string;
  name: string;
  phone?: string | null;
  position: number;
  status: string;
  createdAt: string;
  serviceStartedAt?: string | null;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [selectedQueueId, setSelectedQueueId] = useState<string>("");
  const [entries, setEntries] = useState<QueueEntry[]>([]);

  const [queueName, setQueueName] = useState("");
  const [creating, setCreating] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [showQrModal, setShowQrModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);

  const socketRef = useRef<Socket | null>(null);

  // Initialize Socket.IO connection
  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketConnected(true);
      if (selectedQueueId && token) {
        socket.emit("join_admin_room", { queueId: selectedQueueId, token });
      }
    });

    socket.on("disconnect", () => {
      setSocketConnected(false);
    });

    socket.on("queue:admin_updated", (data) => {
      if (data.queueId === selectedQueueId) {
        setEntries(data.entries || []);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [selectedQueueId, token]);

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    const savedRole = localStorage.getItem("role");
    if (!savedToken) {
      router.push("/admin");
      return;
    }
    if (savedRole !== "ADMIN" && savedRole !== "SUPER_ADMIN") {
      router.push("/dashboard");
      return;
    }
    setToken(savedToken);
    fetchQueues(savedToken);
  }, [router]);

  useEffect(() => {
    if (selectedQueueId && token) {
      fetchEntries(selectedQueueId, token);
      if (socketRef.current) {
        socketRef.current.emit("join_admin_room", {
          queueId: selectedQueueId,
          token,
        });
      }
    }
  }, [selectedQueueId, token]);

  const fetchQueues = async (authToken: string) => {
    try {
      setError("");
      const res = await fetch(`${API_BASE}/queues`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setQueues(data);
        if (data.length > 0 && !selectedQueueId) {
          setSelectedQueueId(data[0].id);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || "Failed to load queues. Access denied or server unavailable.");
      }
    } catch (err: any) {
      console.error("Failed to fetch queues", err);
      setError(err.message || "Unable to connect to queue service.");
    }
  };

  const fetchEntries = async (queueId: string, authToken: string) => {
    try {
      setLoadingEntries(true);
      const res = await fetch(`${API_BASE}/queues/${queueId}/entries`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } catch (err) {
      console.error("Failed to fetch entries", err);
    } finally {
      setLoadingEntries(false);
    }
  };

  const handleCreateQueue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || queueName.trim().length < 2) return;

    try {
      setCreating(true);
      setError("");
      const res = await fetch(`${API_BASE}/queues`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: queueName }),
      });

      if (res.ok) {
        const newQueue = await res.json();
        setQueues((prev) => [newQueue, ...prev]);
        setSelectedQueueId(newQueue.id);
        setQueueName("");
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || "Failed to create queue");
      }
    } catch (err: any) {
      setError(err.message || "Error creating queue");
    } finally {
      setCreating(false);
    }
  };

  const handleAdminDone = async (entryId: string) => {
    if (!token) return;
    const actionKey = `done-${entryId}`;
    try {
      setActiveActionId(actionKey);
      const res = await fetch(
        `${API_BASE}/admin/queue-entries/${entryId}/done`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (res.ok) {
        fetchEntries(selectedQueueId, token);
      }
    } catch (err) {
      console.error("Error marking done", err);
    } finally {
      setActiveActionId((prev) => (prev === actionKey ? null : prev));
    }
  };

  const handleAdminRemove = async (entryId: string) => {
    if (!token) return;
    const actionKey = `remove-${entryId}`;
    try {
      setActiveActionId(actionKey);
      const res = await fetch(
        `${API_BASE}/admin/queue-entries/${entryId}/remove`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (res.ok) {
        fetchEntries(selectedQueueId, token);
      }
    } catch (err) {
      console.error("Error removing entry", err);
    } finally {
      setActiveActionId((prev) => (prev === actionKey ? null : prev));
    }
  };

  const handleAdminReorder = async (
    entryId: string,
    targetPosition: number,
  ) => {
    if (!token || targetPosition < 1) return;
    const actionKey = `reorder-${entryId}`;
    try {
      setActiveActionId(actionKey);
      const res = await fetch(
        `${API_BASE}/admin/queue-entries/${entryId}/reorder`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ targetPosition }),
        },
      );

      if (res.ok) {
        fetchEntries(selectedQueueId, token);
      }
    } catch (err) {
      console.error("Error reordering", err);
    } finally {
      setActiveActionId((prev) => (prev === actionKey ? null : prev));
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    router.push("/admin");
  };

  const activeQueue = queues.find((q) => q.id === selectedQueueId);

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-6 rounded-xl border border-slate-200 shadow-sm mb-6 gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold text-slate-800">
                Organization Dashboard
              </h1>
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-full ${
                  socketConnected
                    ? "bg-emerald-100 text-emerald-700 border border-emerald-300"
                    : "bg-amber-100 text-amber-700 border border-amber-300"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    socketConnected
                      ? "bg-emerald-500 animate-pulse"
                      : "bg-amber-500"
                  }`}
                />
                {socketConnected ? "Live" : "Reconnecting…"}
              </span>
            </div>
            <p className="text-sm text-slate-500">
              Real-Time Queue Operations & Visitor Tracking
            </p>
          </div>
          <div className="flex items-center gap-3">
            {typeof window !== "undefined" &&
              localStorage.getItem("role") === "SUPER_ADMIN" && (
                <Link
                  href="/super-admin"
                  className="px-3.5 py-2 bg-purple-100 text-purple-700 hover:bg-purple-200 font-semibold rounded-lg transition text-xs border border-purple-300"
                >
                  Super Admin Portal →
                </Link>
              )}
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-slate-100 text-slate-700 font-medium rounded-lg hover:bg-slate-200 transition text-sm"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Top Error Alert Banner */}
        {error && (
          <div className="p-4 mb-6 text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold">Error:</span>
              <span>{error}</span>
            </div>
            <button
              onClick={() => setError("")}
              className="text-xs font-semibold text-rose-600 hover:text-rose-800"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Queue Selector & Creation */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h2 className="text-lg font-bold text-slate-800 mb-4">
                Create Queue
              </h2>
              {error && (
                <div className="p-3 mb-4 text-xs text-rose-700 bg-rose-50 rounded-lg">
                  {error}
                </div>
              )}
              <form onSubmit={handleCreateQueue} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Queue Name
                  </label>
                  <input
                    type="text"
                    name="queueName"
                    value={queueName}
                    onChange={(e) => setQueueName(e.target.value)}
                    disabled={creating}
                    placeholder="e.g. Service Desk A"
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-50"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={creating}
                  className="w-full bg-emerald-600 text-white font-semibold py-2.5 rounded-lg text-sm hover:bg-emerald-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {creating ? (
                    <>
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    "Create Queue"
                  )}
                </button>
              </form>
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h2 className="text-lg font-bold text-slate-800 mb-4">
                Your Queues
              </h2>
              {queues.length === 0 ? (
                <p className="text-sm text-slate-500">No queues created yet.</p>
              ) : (
                <div className="space-y-2">
                  {queues.map((q) => (
                    <button
                      key={q.id}
                      onClick={() => setSelectedQueueId(q.id)}
                      className={`w-full text-left p-3 rounded-lg border text-sm font-medium transition flex justify-between items-center ${
                        selectedQueueId === q.id
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <span className="truncate">{q.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-600 uppercase font-semibold">
                        {q.status}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Active Queue Dashboard */}
          <div className="lg:col-span-2">
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              {activeQueue ? (
                <>
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-4 border-b border-slate-200 mb-6 gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-slate-800">
                        {activeQueue.name}
                      </h2>
                      <p className="text-xs text-slate-500">
                        Live Active Queue (Auto-Syncing)
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setShowQrModal(true)}
                        className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-300 px-3 py-1.5 rounded-lg font-semibold hover:bg-emerald-100 transition flex items-center gap-1.5"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <rect x="3" y="3" width="7" height="7" />
                          <rect x="14" y="3" width="7" height="7" />
                          <rect x="14" y="14" width="7" height="7" />
                          <rect x="3" y="14" width="7" height="7" />
                        </svg>
                        View QR Code
                      </button>
                      <a
                        href={`/queue/${activeQueue.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="qr-link text-xs bg-blue-50 text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg font-medium hover:bg-blue-100 transition"
                      >
                        Open Public Page
                      </a>
                      <button
                        onClick={() => fetchEntries(activeQueue.id, token!)}
                        className="text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg border border-slate-200 font-medium hover:bg-slate-200 transition"
                      >
                        Refresh List
                      </button>
                    </div>
                  </div>

                  {loadingEntries ? (
                    <div className="text-center py-12 text-slate-500 text-sm flex items-center justify-center gap-2">
                      <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
                      Loading active queue...
                    </div>
                  ) : entries.length === 0 ? (
                    <div className="text-center py-12 bg-slate-50 rounded-lg border border-dashed border-slate-200 text-slate-500 text-sm">
                      No active visitors waiting in this queue.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 text-xs font-bold text-slate-500 uppercase bg-slate-50">
                            <th className="py-3 px-4">Pos</th>
                            <th className="py-3 px-4">Visitor</th>
                            <th className="py-3 px-4">Phone</th>
                            <th className="py-3 px-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {entries.map((entry) => {
                            const isMoving = activeActionId === `reorder-${entry.id}`;
                            const isCompleting = activeActionId === `done-${entry.id}`;
                            const isRemoving = activeActionId === `remove-${entry.id}`;

                            return (
                              <tr
                                key={entry.id}
                                className="hover:bg-slate-50/80 transition text-sm"
                              >
                                <td className="py-3 px-4 font-bold text-blue-600">
                                  #{entry.position}
                                </td>
                                <td className="py-3 px-4 font-medium text-slate-800">
                                  {entry.name}
                                  {entry.position === 1 && (
                                    <span className="ml-2 text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                                      Serving
                                    </span>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-slate-500 text-xs">
                                  {entry.phone || "N/A"}
                                </td>
                                <td className="py-3 px-4 text-right">
                                  <div className="flex items-center justify-end space-x-1 sm:space-x-2">
                                    <button
                                      onClick={() =>
                                        handleAdminReorder(
                                          entry.id,
                                          entry.position - 1,
                                        )
                                      }
                                      disabled={
                                        isMoving || entry.position <= 1
                                      }
                                      title="Move Up"
                                      className="px-2 py-1 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded text-xs disabled:opacity-30 font-medium"
                                    >
                                      ↑
                                    </button>

                                    <button
                                      onClick={() =>
                                        handleAdminReorder(
                                          entry.id,
                                          entry.position + 1,
                                        )
                                      }
                                      disabled={
                                        isMoving ||
                                        entry.position >= entries.length
                                      }
                                      title="Move Down"
                                      className="px-2 py-1 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded text-xs disabled:opacity-30 font-medium"
                                    >
                                      ↓
                                    </button>

                                    <button
                                      onClick={() => handleAdminDone(entry.id)}
                                      disabled={isCompleting || isRemoving}
                                      className="px-3 py-1 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-700 transition disabled:opacity-50"
                                    >
                                      {isCompleting ? "Completing…" : "DONE"}
                                    </button>

                                    <button
                                      onClick={() => handleAdminRemove(entry.id)}
                                      disabled={isRemoving || isCompleting}
                                      className="px-3 py-1 bg-rose-50 text-rose-600 border border-rose-200 rounded text-xs font-semibold hover:bg-rose-100 transition disabled:opacity-50"
                                    >
                                      {isRemoving ? "Removing…" : "REMOVE"}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-16 text-slate-500">
                  Select or create a queue to start managing.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Admin QR Code Modal */}
        {showQrModal && activeQueue && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 text-center space-y-4 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                <h3 className="font-bold text-slate-800 text-lg">Queue QR Code</h3>
                <button
                  onClick={() => setShowQrModal(false)}
                  className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1 rounded-lg hover:bg-slate-100 transition"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div>
                <p className="font-bold text-slate-900 text-base">{activeQueue.name}</p>
                <p className="text-xs text-slate-500 mt-1">
                  Visitors scan this QR code with their mobile camera to join the virtual queue.
                </p>
              </div>

              <div className="flex justify-center p-4 bg-slate-50 rounded-xl border border-slate-200 shadow-inner">
                <QRCodeSVG
                  value={`${typeof window !== "undefined" ? window.location.origin : ""}/queue/${activeQueue.id}`}
                  size={200}
                  level="H"
                  includeMargin={true}
                />
              </div>

              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-1.5 bg-slate-100 p-2 rounded-lg text-xs text-slate-600">
                  <span className="truncate flex-1 text-left font-mono text-[11px]">
                    {typeof window !== "undefined"
                      ? `${window.location.origin}/queue/${activeQueue.id}`
                      : `/queue/${activeQueue.id}`}
                  </span>
                  <button
                    onClick={() => {
                      if (typeof window !== "undefined") {
                        navigator.clipboard.writeText(
                          `${window.location.origin}/queue/${activeQueue.id}`
                        );
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }
                    }}
                    className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-300 rounded text-slate-700 font-medium text-xs whitespace-nowrap shadow-sm transition"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>

                <div className="flex gap-2">
                  <a
                    href={`/queue/${activeQueue.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold border border-blue-200 transition text-center"
                  >
                    Open Page ↗
                  </a>
                  <button
                    onClick={() => setShowQrModal(false)}
                    className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
