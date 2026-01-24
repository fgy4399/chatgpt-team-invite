"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface StatusData {
  status: string;
  email: string;
  message: string;
  createdAt: string;
  processedAt?: string;
}

export default function StatusPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/invite/status/${id}`);
        if (res.ok) {
          setData(await res.json());
        } else {
          setError("未找到邀请记录");
        }
      } catch {
        setError("获取状态失败");
      }
    };

    fetchStatus();
  }, [id]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "SUCCESS":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "FAILED":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
      default:
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
    }
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      SUCCESS: "已发送",
      FAILED: "失败",
      PENDING: "处理中",
    };
    return labels[status] || status;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "SUCCESS":
        return (
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case "FAILED":
        return (
          <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      default:
        return (
          <svg className="w-8 h-8 text-yellow-600 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        );
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-linear-to-br from-violet-50 via-white to-violet-100 dark:from-zinc-950 dark:via-zinc-950 dark:to-violet-950/40 p-4 flex items-center justify-center">
        <div className="w-full max-w-md rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow-xl p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-700 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center justify-center px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-violet-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-zinc-900"
          >
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-linear-to-br from-violet-50 via-white to-violet-100 dark:from-zinc-950 dark:via-zinc-950 dark:to-violet-950/40 p-4 flex items-center justify-center">
        <div className="w-full max-w-md rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow-xl p-8 text-center">
          <div className="flex items-center justify-center gap-3 text-sm text-zinc-600 dark:text-zinc-300">
            <svg className="animate-spin h-5 w-5 text-violet-600" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            正在加载状态...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-violet-50 via-white to-violet-100 dark:from-zinc-950 dark:via-zinc-950 dark:to-violet-950/40 p-4 flex items-center justify-center">
      <div className="w-full max-w-lg rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow-xl p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-violet-100 dark:bg-violet-500/15">
              {getStatusIcon(data.status)}
            </div>
            <div>
              <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">
                邀请状态
              </h1>
              <div className="mt-1">
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(
                    data.status
                  )}`}
                >
                  {getStatusLabel(data.status)}
                </span>
              </div>
            </div>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors"
          >
            返回
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
        </div>

        <div className="rounded-xl border border-zinc-200/70 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/40 overflow-hidden">
          <div className="px-4 py-3 bg-violet-50/70 dark:bg-violet-500/10 border-b border-zinc-200/70 dark:border-zinc-700 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            详情
          </div>
          <div className="p-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-zinc-500 dark:text-zinc-400">邮箱</span>
              <span className="text-zinc-900 dark:text-white font-medium">{data.email}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-zinc-500 dark:text-zinc-400">创建时间</span>
              <span className="text-zinc-900 dark:text-white">
                {new Date(data.createdAt).toLocaleString()}
              </span>
            </div>
            {data.processedAt && (
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500 dark:text-zinc-400">处理时间</span>
                <span className="text-zinc-900 dark:text-white">
                  {new Date(data.processedAt).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 rounded-xl bg-zinc-50/80 dark:bg-zinc-900/40 border border-zinc-200/70 dark:border-zinc-700 p-4">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
            提示
          </div>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">{data.message}</p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <Link
            href="/"
            className="inline-flex items-center justify-center py-3 px-4 rounded-xl bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white font-medium transition-colors"
          >
            返回首页
          </Link>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center py-3 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-violet-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-zinc-900"
          >
            刷新状态
          </button>
        </div>
      </div>
    </div>
  );
}
