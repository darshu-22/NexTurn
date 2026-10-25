"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("token");
    const role = localStorage.getItem("role");

    if (!token) {
      router.push("/login");
    } else if (role === "SUPER_ADMIN") {
      router.push("/super-admin");
    } else if (role === "ADMIN") {
      router.push("/admin/dashboard");
    } else {
      router.push("/dashboard");
    }
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 text-slate-100 p-4">
      <noscript>
        <meta httpEquiv="refresh" content="0; url=/login" />
        <div className="text-center space-y-4 mb-4">
          <h1 className="text-2xl font-bold">NexTurn</h1>
          <p className="text-slate-400">
            Please enable JavaScript or{" "}
            <a href="/login" className="text-blue-400 underline">
              click here to sign in
            </a>
            .
          </p>
        </div>
      </noscript>
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
    </div>
  );
}
