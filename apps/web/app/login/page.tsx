"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export default function UnifiedLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("Signing in…");
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return; // Prevent double submission

    setError("");
    setLoading(true);
    setLoadingMsg("Signing in…");

    // Progressive loading messages for backend cold start responsiveness
    const timer1 = setTimeout(() => setLoadingMsg("Connecting to NexTurn…"), 3000);
    const timer2 = setTimeout(() => setLoadingMsg("NexTurn is waking up. This may take a few seconds…"), 7000);
    const timer3 = setTimeout(() => setLoadingMsg("Still connecting to NexTurn…"), 12000);

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Invalid credentials");
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("role", data.role);
      localStorage.setItem("user", JSON.stringify(data.user || {}));

      if (data.role === "SUPER_ADMIN") {
        router.push("/super-admin");
      } else if (data.role === "ADMIN") {
        router.push("/admin/dashboard");
      } else {
        const searchParams = new URLSearchParams(
          typeof window !== "undefined" ? window.location.search : "",
        );
        const redirectUrl = searchParams.get("redirect");
        if (redirectUrl) {
          router.push(redirectUrl);
        } else {
          router.push("/dashboard");
        }
      }
    } catch (err: any) {
      if (err.name === "TypeError" || err.message?.includes("fetch")) {
        setError("Unable to connect to NexTurn. Please check your network connection and try again.");
      } else {
        setError(err.message || "Invalid credentials");
      }
    } finally {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-slate-900 text-slate-100">
      <div className="w-full max-w-md p-8 bg-slate-800 border border-slate-700 rounded-2xl shadow-xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">
            Nex<span className="text-blue-500">Turn</span>
          </h1>
          <p className="text-slate-400 text-sm">
            Sign in to access your dashboard
          </p>
        </div>

        {error && (
          <div className="p-3 mb-6 text-sm text-rose-300 bg-rose-950/50 border border-rose-800/60 rounded-xl">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:outline-none transition disabled:opacity-50"
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:outline-none transition disabled:opacity-50"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold p-3.5 rounded-xl transition duration-200 disabled:opacity-60 shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>{loadingMsg}</span>
              </>
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-700/60 text-center text-sm text-slate-400">
          Don't have an account?{" "}
          <Link
            href="/signup"
            className="text-blue-400 font-medium hover:underline ml-1"
          >
            Create Customer Account
          </Link>
        </div>
      </div>
    </div>
  );
}
