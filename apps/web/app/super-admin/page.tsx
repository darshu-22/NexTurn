"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export default function SuperAdminDashboard() {
  const [admins, setAdmins] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);

  // Form fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [modalLoading, setModalLoading] = useState(false);

  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("token");
    const role = localStorage.getItem("role");

    if (!token || role !== "SUPER_ADMIN") {
      router.push("/login");
      return;
    }

    fetchAdmins(token);
  }, []);

  const fetchAdmins = async (token: string) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/super-admin/admins`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        if (res.status === 403) {
          router.push("/login");
          return;
        }
        throw new Error("Failed to load admin list");
      }

      const data = await res.json();
      setAdmins(data || []);
    } catch (err: any) {
      setError(err.message || "Failed to load admins");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    const token = localStorage.getItem("token");
    if (!token) return;

    try {
      setModalLoading(true);
      const res = await fetch(`${API_BASE}/super-admin/admins`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          email,
          phone: phone || undefined,
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create admin");
      }

      setSuccessMsg(`Admin account created for ${data.name}`);
      setName("");
      setEmail("");
      setPhone("");
      setPassword("");
      setShowAddModal(false);
      fetchAdmins(token);
    } catch (err: any) {
      setError(err.message || "Failed to create admin");
    } finally {
      setModalLoading(false);
    }
  };

  const handleToggleStatus = async (adminId: string, currentStatus: string) => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const newStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";

    try {
      const res = await fetch(
        `${API_BASE}/super-admin/admins/${adminId}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: newStatus }),
        },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update admin status");
      }

      fetchAdmins(token);
    } catch (err: any) {
      setError(err.message || "Failed to toggle status");
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
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Top Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-800 border border-slate-700 rounded-2xl shadow-lg">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-extrabold text-white tracking-tight">
                Super Admin Dashboard
              </h1>
              <span className="px-3 py-1 text-xs font-bold bg-purple-900/80 text-purple-300 border border-purple-600/60 rounded-full">
                SUPER_ADMIN
              </span>
            </div>
            <p className="text-slate-400 text-sm mt-1">
              Manage organization administrators and system governance
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/admin/dashboard"
              className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition"
            >
              Queue Management →
            </Link>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm bg-rose-900/60 hover:bg-rose-800/80 text-rose-200 border border-rose-700/60 font-medium rounded-xl transition"
            >
              Log Out
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 text-sm text-rose-300 bg-rose-950/60 border border-rose-800 rounded-xl">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="p-4 text-sm text-emerald-300 bg-emerald-950/60 border border-emerald-800 rounded-xl">
            {successMsg}
          </div>
        )}

        {/* Admin Management Section */}
        <div className="p-6 bg-slate-800 border border-slate-700 rounded-2xl space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">Admin Accounts</h2>
              <p className="text-slate-400 text-sm">
                N ADMIN users belonging to your organization
              </p>
            </div>

            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm rounded-xl transition shadow-lg shadow-purple-600/20 flex items-center gap-2"
            >
              <span>+ Add Admin Account</span>
            </button>
          </div>

          {admins.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-slate-700 rounded-xl">
              <p className="text-slate-400 text-sm mb-2">
                No ADMIN accounts exist yet for this organization.
              </p>
              <p className="text-xs text-slate-500 mb-4">
                Click "Add Admin Account" above to create an administrator.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-700 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    <th className="py-3 px-4">Name</th>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4">Phone</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/60 text-sm">
                  {admins.map((adm) => (
                    <tr key={adm.id} className="hover:bg-slate-750/50">
                      <td className="py-3.5 px-4 font-medium text-white">
                        {adm.name}
                      </td>
                      <td className="py-3.5 px-4 text-slate-300">
                        {adm.email}
                      </td>
                      <td className="py-3.5 px-4 text-slate-400">
                        {adm.phone || "—"}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2.5 py-0.5 text-xs font-semibold bg-blue-900/60 text-blue-300 border border-blue-700/60 rounded-md">
                          {adm.role}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2.5 py-0.5 text-xs font-semibold rounded-md ${
                            adm.status === "ACTIVE"
                              ? "bg-emerald-900/60 text-emerald-300 border border-emerald-700/60"
                              : "bg-amber-900/60 text-amber-300 border border-amber-700/60"
                          }`}
                        >
                          {adm.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => handleToggleStatus(adm.id, adm.status)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                            adm.status === "ACTIVE"
                              ? "bg-amber-900/50 hover:bg-amber-800/70 text-amber-200 border border-amber-700/50"
                              : "bg-emerald-900/50 hover:bg-emerald-800/70 text-emerald-200 border border-emerald-700/50"
                          }`}
                        >
                          {adm.status === "ACTIVE" ? "Disable" : "Enable"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Add Admin Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md p-6 space-y-5 shadow-2xl">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-white">
                  Add Admin Account
                </h3>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="text-slate-400 hover:text-white text-lg font-bold"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateAdmin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Admin Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    placeholder="Alice Johnson"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    placeholder="alice@example.com"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Phone Number (Optional)
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    placeholder="+15559998888"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    placeholder="At least 6 characters"
                    required
                    minLength={6}
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold p-3 rounded-xl transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={modalLoading}
                    className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-semibold p-3 rounded-xl transition disabled:opacity-50"
                  >
                    {modalLoading ? "Creating..." : "Create Admin"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
