"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { io, Socket } from "socket.io-client";

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

  const socketRef = useRef<Socket | null>(null);

  // Initialize Socket.IO connection
  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      if (selectedQueueId && token) {
        socket.emit("join_admin_room", { queueId: selectedQueueId, token });
      }
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
    if (!savedToken) {
      router.push("/admin");
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
      const res = await fetch(`${API_BASE}/queues`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setQueues(data);
        if (data.length > 0 && !selectedQueueId) {
          setSelectedQueueId(data[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to fetch queues", err);
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
        const errData = await res.json();
        setError(errData.error || "Failed to create queue");
      }
    } catch (err) {
      setError("Error creating queue");
    } finally {
      setCreating(false);
    }
  };

  const handleAdminDone = async (entryId: string) => {
    if (!token) return;
    try {
      setActionLoading(true);
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
      setActionLoading(false);
    }
  };

  const handleAdminRemove = async (entryId: string) => {
    if (!token) return;
    try {
      setActionLoading(true);
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
      setActionLoading(false);
    }
  };

  const handleAdminReorder = async (
    entryId: string,
    targetPosition: number,
  ) => {
    if (!token || targetPosition < 1) return;
    try {
      setActionLoading(true);
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
      setActionLoading(false);
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
            <h1 className="text-2xl font-bold text-slate-800">
              Organization Dashboard
            </h1>
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
                    placeholder="e.g. Service Desk A"
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={creating}
                  className="w-full bg-emerald-600 text-white font-semibold py-2.5 rounded-lg text-sm hover:bg-emerald-700 transition disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Create Queue"}
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
                    <div className="text-center py-12 text-slate-500 text-sm">
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
                          {entries.map((entry) => (
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
                                      actionLoading || entry.position <= 1
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
                                      actionLoading ||
                                      entry.position >= entries.length
                                    }
                                    title="Move Down"
                                    className="px-2 py-1 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded text-xs disabled:opacity-30 font-medium"
                                  >
                                    ↓
                                  </button>

                                  <button
                                    onClick={() => handleAdminDone(entry.id)}
                                    disabled={actionLoading}
                                    className="px-3 py-1 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-700 transition disabled:opacity-50"
                                  >
                                    DONE
                                  </button>

                                  <button
                                    onClick={() => handleAdminRemove(entry.id)}
                                    disabled={actionLoading}
                                    className="px-3 py-1 bg-rose-50 text-rose-600 border border-rose-200 rounded text-xs font-semibold hover:bg-rose-100 transition disabled:opacity-50"
                                  >
                                    REMOVE
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
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
      </div>
    </div>
  );
}
