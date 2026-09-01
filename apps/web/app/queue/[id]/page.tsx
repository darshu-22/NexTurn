"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export default function PublicQueuePage() {
  const params = useParams();
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
  } | null>(null);

  // Modal State for Leaving Queue
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Check existing session on load
  useEffect(() => {
    if (!queueId) return;

    fetchQueueInfo();
    checkExistingSession();
  }, [queueId]);

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
        setEntryData({
          id: data.entry.id,
          name: data.entry.name,
          position: data.entry.position,
          status: data.entry.status,
          sessionToken,
          peopleAhead: data.peopleAhead,
          queueName: data.queueName,
        });
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

    if (name.trim().length < 2) {
      setError("Name must be at least 2 characters");
      return;
    }

    try {
      setJoining(true);
      const res = await fetch(`${API_BASE}/queues/${queueId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to join queue");
      }

      const data = await res.json();
      const newEntryData = {
        id: data.entry.id,
        name: data.entry.name,
        position: data.entry.position,
        status: data.entry.status,
        sessionToken: data.sessionToken,
        peopleAhead: data.peopleAhead,
        queueName: data.queueName,
      };

      // Store session token locally
      localStorage.setItem(
        `nexturn_session_${queueId}`,
        JSON.stringify({
          entryId: data.entry.id,
          sessionToken: data.sessionToken,
        }),
      );

      setEntryData(newEntryData);
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
        const data = await res.json();
        setEntryData((prev) =>
          prev ? { ...prev, status: "COMPLETED" } : null,
        );
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

  // Active or completed queue entry view
  if (entryData) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-slate-50">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-md p-6 text-center">
          <h2 className="text-lg font-semibold text-slate-500 mb-1">
            {entryData.queueName || queueInfo?.name}
          </h2>
          <h1 className="text-2xl font-bold text-slate-800 mb-6">
            Hello, {entryData.name}!
          </h1>

          {entryData.status === "WAITING" && (
            <>
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-6 mb-6">
                <p className="text-sm font-medium text-blue-600 uppercase tracking-wide">
                  You're in the queue
                </p>
                <div className="text-5xl font-extrabold text-blue-700 my-2">
                  #{entryData.position}
                </div>
                <p className="text-slate-600 text-sm font-medium">
                  {entryData.peopleAhead}{" "}
                  {entryData.peopleAhead === 1 ? "person" : "people"} ahead of
                  you
                </p>
              </div>

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

        {/* Confirmation Modal for Leaving Queue */}
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

  // Initial Registration View
  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-slate-50">
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
    </div>
  );
}
