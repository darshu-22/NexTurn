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
    } else if (role === "ADMIN" || role === "ORGANIZATION_ADMIN") {
      router.push("/admin/dashboard");
    } else {
      router.push("/dashboard");
    }
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
    </div>
  );
}
