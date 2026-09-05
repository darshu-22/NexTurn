"use client";

import React, { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000";

interface ToastNotification {
  id: string;
  type: "info" | "success" | "alert";
  title: string;
  message: string;
}

export default function PublicQueuePage() {
  const params = useParams();
  const router = useRouter();
  const queueId = params?.id as string;

  const [queueInfo, setQueueInfo] = useState<{
    id: string;
    name: string;
    status: string;
  } | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");

  // Queue Entry State
  const [entryData, setEntryData] = useState<{
    id: string;
    name: string;
    position: number;
    status: string;
    sessionToken: string;
    peopleAhead: number;
    queueName: string;
    averageServiceDurationMinutes?: number | null;
    estimatedWaitMinutes?: number | null;
  } | null>(null);

  // Website Notifications State
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const lastNotifiedPositionRef = useRef<number | null>(null);
  const initialLoadRef = useRef<boolean>(true);

  // Modal State for Leaving Queue
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const socketRef = useRef<Socket | null>(null);

  const addToast = (
    type: "info" | "success" | "alert",
    title: string,
    message: string,
  ) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`;
    setToasts((prev) => [...prev, { id, type, title, message }]);

    // Auto-dismiss after 6 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 6000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Socket.IO Realtime Connection & Notification Handlers
  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      if (entryData) {
        socket.emit("join_public_room", {
          entryId: entryData.id,
          sessionToken: entryData.sessionToken,
        });
      }
    });

    socket.on("queue:status_updated", (data) => {
      const newPos = data.entry.position;
      const prevPos = lastNotifiedPositionRef.current;

      setEntryData((prev) =>
        prev
          ? {
              ...prev,
              position: newPos,
              status: data.entry.status,
              peopleAhead: data.peopleAhead,
              estimatedWaitMinutes: data.estimatedWaitMinutes,
              averageServiceDurationMinutes: data.averageServiceDurationMinutes,
            }
          : null,
      );

      // Website Notification Logic (Only trigger toast if position actually changes, ignoring initial connect / page refresh)
      if (
        prevPos !== null &&
        prevPos !== newPos &&
        data.entry.status === "WAITING"
      ) {
        if (newPos === 1) {
          if (data.isQueueCleared || data.eventType === "QUEUE_CLEARED") {
            addToast(
              "success",
              "🎉 It's your turn!",
              "🚨 The queue has cleared! It's your turn now. Please proceed.",
            );
          } else {
            addToast("success", "🎉 It's your turn!", "Please proceed now.");
          }
        } else if (newPos === 2) {
          addToast(
            "alert",
            "You're almost there!",
            "Your current position is #2.",
          );
        } else if (newPos < prevPos) {
          addToast(
            "info",
            "Position Update",
            `Your position is now #${newPos}.`,
          );
        }
      }

      lastNotifiedPositionRef.current = newPos;
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Check existing session on load
  useEffect(() => {
    if (!queueId) return;

    fetchQueueInfo();
    checkExistingSession();
    checkUserAuth();
  }, [queueId]);

  const checkUserAuth = async () => {
    const userToken = localStorage.getItem("token");
    if (!userToken) return;

    try {
      const storedUser = localStorage.getItem("user");
      if (storedUser) {
        const parsed = JSON.parse(storedUser);
        if (parsed.name) setName(parsed.name);
        if (parsed.phone) setPhone(parsed.phone);
      } else {
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${userToken}` },
        });
        if (res.ok) {
          const userData = await res.json();
          if (userData.name) setName(userData.name);
          if (userData.phone) setPhone(userData.phone);
        }
      }
    } catch (err) {}
  };

  const fetchQueueInfo = async () => {
    try {
      setLoadingQueue(true);
      const res = await fetch(`${API_BASE}/queues/${queueId}/public`);
      if (res.ok) {
        const data = await res.json();
        setQueueInfo(data);
      } else {
        setError("Queue not found or closed");
      }
    } catch (err) {
      setError("Unable to connect to queue service");
    } finally {
      setLoadingQueue(false);
    }
  };

  const checkExistingSession = async () => {
    const savedSession = localStorage.getItem(`nexturn_session_${queueId}`);
    if (!savedSession) return;

    try {
      const { entryId, sessionToken } = JSON.parse(savedSession);
      const res = await fetch(`${API_BASE}/queue-entries/${entryId}`, {
        headers: { "x-session-token": sessionToken },
      });

      if (res.ok) {
        const data = await res.json();
        const currentPos = data.entry.position;

        setEntryData({
          id: data.entry.id,
          name: data.entry.name,
          position: currentPos,
          status: data.entry.status,
          sessionToken,
          peopleAhead: data.peopleAhead,
          queueName: data.queueName,
          averageServiceDurationMinutes: data.averageServiceDurationMinutes,
          estimatedWaitMinutes: data.estimatedWaitMinutes,
        });

        lastNotifiedPositionRef.current = currentPos;

        if (socketRef.current) {
          socketRef.current.emit("join_public_room", {
            entryId: data.entry.id,
            sessionToken,
          });
        }
      } else {
        localStorage.removeItem(`nexturn_session_${queueId}`);
      }
    } catch (err) {
      console.error("Session check failed", err);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const userToken = localStorage.getItem("token");
    if (!userToken) {
      router.push(`/login?redirect=/queue/${queueId}`);
      return;
    }

    try {
      setJoining(true);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      };

      const res = await fetch(`${API_BASE}/queues/${queueId}/join`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: name || undefined,
          phone: phone || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to join queue");
      }

      const data = await res.json();
      const pos = data.entry.position;

      const newEntryData = {
        id: data.entry.id,
        name: data.entry.name,
        position: pos,
        status: data.entry.status,
        sessionToken: data.sessionToken,
        peopleAhead: data.peopleAhead,
        queueName: data.queueName,
        averageServiceDurationMinutes: data.averageServiceDurationMinutes,
        estimatedWaitMinutes: data.estimatedWaitMinutes,
      };

      localStorage.setItem(
        `nexturn_session_${queueId}`,
        JSON.stringify({
          entryId: data.entry.id,
          sessionToken: data.sessionToken,
        }),
      );

      setEntryData(newEntryData);
      lastNotifiedPositionRef.current = pos;

      // Join socket room
      if (socketRef.current) {
        socketRef.current.emit("join_public_room", {
          entryId: data.entry.id,
          sessionToken: data.sessionToken,
        });
      }

      // Display Initial Join Website Notification
      if (pos === 1) {
        addToast(
          "success",
          "🎉 It's your turn!",
          "You are first in line! Please proceed to the counter.",
        );
      } else {
        addToast(
          "info",
          "You're in the queue!",
          `Your current position is #${pos}. We'll keep you updated as your turn gets closer.`,
        );
      }
    } catch (err: any) {
      setError(err.message || "An error occurred while joining");
    } finally {
      setJoining(false);
    }
  };

  const refreshStatus = async () => {
    if (!entryData) return;
    try {
      setActionLoading(true);
      const res = await fetch(`${API_BASE}/queue-entries/${entryData.id}`, {
        headers: { "x-session-token": entryData.sessionToken },
      });
      if (res.ok) {
        const data = await res.json();
        setEntryData((prev) =>
          prev
            ? {
                ...prev,
                position: data.entry.position,
                status: data.entry.status,
                peopleAhead: data.peopleAhead,
                estimatedWaitMinutes: data.estimatedWaitMinutes,
                averageServiceDurationMinutes:
                  data.averageServiceDurationMinutes,
              }
            : null,
        );
      }
    } catch (err) {
      console.error("Refresh error", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUserDone = async () => {
    if (!entryData) return;
    try {
      setActionLoading(true);
      const res = await fetch(
        `${API_BASE}/queue-entries/${entryData.id}/done`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-session-token": entryData.sessionToken,
          },
        },
      );
      if (res.ok) {
        setEntryData((prev) =>
          prev ? { ...prev, status: "COMPLETED" } : null,
        );
        addToast("success", "Service Completed", "Thank you for visiting!");
      }
    } catch (err) {
      console.error("Complete error", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmLeave = async () => {
    if (!entryData) return;
    try {
      setActionLoading(true);
      const res = await fetch(
        `${API_BASE}/queue-entries/${entryData.id}/cancel`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-session-token": entryData.sessionToken,
          },
        },
      );

      if (res.ok) {
        setEntryData((prev) =>
          prev ? { ...prev, status: "CANCELLED" } : null,
        );
        setShowLeaveModal(false);
      }
    } catch (err) {
      console.error("Cancel error", err);
    } finally {
      setActionLoading(false);
    }
  };

  if (loadingQueue) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-slate-50">
        <div className="text-slate-600 font-medium">
          Loading Queue Details...
        </div>
      </div>
    );
  }

  if (error && !entryData) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-slate-50">
        <div className="w-full max-w-md p-6 bg-white border border-slate-200 rounded-lg shadow-sm text-center">
          <h1 className="text-xl font-bold text-slate-800 mb-2">
            Queue Unavailable
          </h1>
          <p className="text-slate-600 mb-4">{error}</p>
          <button
            onClick={fetchQueueInfo}
            className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-slate-50 relative">
      {/* Toast Notifications Overlay */}
      <div className="fixed top-4 right-4 left-4 sm:left-auto sm:w-96 z-50 space-y-3 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto p-4 rounded-xl shadow-lg border flex items-start justify-between transition-all duration-300 transform ${
              toast.type === "success"
                ? "bg-emerald-600 text-white border-emerald-500"
                : toast.type === "alert"
                  ? "bg-amber-500 text-white border-amber-400"
                  : "bg-slate-900 text-white border-slate-800"
            }`}
          >
            <div>
              <h4 className="font-bold text-sm mb-0.5">{toast.title}</h4>
              <p className="text-xs opacity-90">{toast.message}</p>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="ml-3 text-white/80 hover:text-white font-bold text-sm"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {entryData ? (
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-md p-6 text-center">
          <h2 className="text-lg font-semibold text-slate-500 mb-1">
            {entryData.queueName || queueInfo?.name}
          </h2>
          <h1 className="text-2xl font-bold text-slate-800 mb-6">
            Hello, {entryData.name}!
          </h1>

          {entryData.status === "WAITING" && (
            <>
              {/* Prominent Website Notification Banner for Position #1 */}
              {entryData.position === 1 ? (
                <div className="bg-emerald-500 text-white p-5 rounded-xl mb-6 shadow-md animate-pulse">
                  <div className="text-3xl mb-1">🎉</div>
                  <h3 className="text-xl font-extrabold mb-1">
                    It's your turn!
                  </h3>
                  <p className="text-sm font-medium text-emerald-100">
                    Please proceed now to the counter.
                  </p>
                </div>
              ) : (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-6 mb-6">
                  <p className="text-sm font-medium text-blue-600 uppercase tracking-wide">
                    You're in the queue
                  </p>
                  <div className="text-5xl font-extrabold text-blue-700 my-2">
                    #{entryData.position}
                  </div>
                  <p className="text-slate-600 text-sm font-medium mb-3">
                    {entryData.peopleAhead}{" "}
                    {entryData.peopleAhead === 1 ? "person" : "people"} ahead of
                    you
                  </p>

                  <div className="inline-block bg-white border border-blue-200 rounded-full px-4 py-1.5 shadow-sm text-sm font-semibold text-blue-800">
                    {entryData.estimatedWaitMinutes !== null &&
                    entryData.estimatedWaitMinutes !== undefined ? (
                      <span>
                        Estimated wait ~{entryData.estimatedWaitMinutes} min
                      </span>
                    ) : (
                      <span className="text-slate-500 italic">
                        Estimated wait: Calculating...
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <button
                  onClick={handleUserDone}
                  disabled={actionLoading}
                  className="w-full py-3 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 transition disabled:opacity-50"
                >
                  Mark Completed
                </button>

                <button
                  onClick={() => setShowLeaveModal(true)}
                  disabled={actionLoading}
                  className="w-full py-3 bg-slate-100 text-rose-600 rounded-lg font-semibold border border-slate-200 hover:bg-rose-50 transition disabled:opacity-50"
                >
                  Leave Queue
                </button>

                <button
                  onClick={refreshStatus}
                  disabled={actionLoading}
                  className="text-sm text-blue-600 font-medium hover:underline pt-2 inline-block"
                >
                  {actionLoading ? "Refreshing..." : "Refresh Position"}
                </button>
              </div>
            </>
          )}

          {entryData.status === "COMPLETED" && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6 my-4">
              <div className="text-emerald-600 text-4xl mb-2">✓</div>
              <h3 className="text-xl font-bold text-emerald-800 mb-1">
                Service Completed
              </h3>
              <p className="text-emerald-700 text-sm">
                Thank you for waiting! You have completed your queue entry.
              </p>
            </div>
          )}

          {entryData.status === "CANCELLED" && (
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-6 my-4">
              <h3 className="text-xl font-bold text-rose-800 mb-1">
                Queue Left
              </h3>
              <p className="text-rose-700 text-sm">You have left this queue.</p>
            </div>
          )}
        </div>
      ) : (
        <form
          onSubmit={handleJoin}
          className="w-full max-w-sm p-6 bg-white border border-slate-200 rounded-xl shadow-md"
        >
          <h1 className="text-2xl font-bold text-slate-800 mb-1">
            {queueInfo?.name || "Join Queue"}
          </h1>
          <p className="text-slate-500 text-sm mb-6">
            Enter your details to receive your position number.
          </p>

          {error && (
            <div className="p-3 mb-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Your Name *
            </label>
            <input
              type="text"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2.5 text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="Enter your name"
              required
              minLength={2}
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Phone Number (Optional)
            </label>
            <input
              type="tel"
              name="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2.5 text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="Enter phone number"
            />
          </div>

          <button
            type="submit"
            disabled={joining}
            className="w-full bg-blue-600 text-white font-semibold p-3 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
          >
            {joining ? "Joining Queue..." : "Join Queue"}
          </button>
        </form>
      )}

      {/* Confirmation Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-sm w-full p-6 shadow-xl text-left">
            <h3 className="text-lg font-bold text-slate-800 mb-2">
              Leave Queue Confirmation
            </h3>
            <p className="text-slate-600 text-sm mb-6">
              Are you sure you want to leave the queue? You will lose your
              current queue position.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => setShowLeaveModal(false)}
                disabled={actionLoading}
                className="flex-1 py-2 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmLeave}
                disabled={actionLoading}
                className="flex-1 py-2 bg-rose-600 text-white rounded-lg font-medium hover:bg-rose-700"
              >
                {actionLoading ? "Leaving..." : "Leave Queue"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
