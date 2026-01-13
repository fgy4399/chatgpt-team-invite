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
      SUCCESS: "成功",
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
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-zinc-100 to-zinc-200 dark:from-zinc-900 dark:to-black p-4">
        <div className="w-full max-w-md bg-white dark:bg-zinc-800 rounded-2xl shadow-xl p-8 text-center">
          <p className="text-red-600 dark:text-red-400">{error}</p>
          <Link href="/" className="mt-4 inline-block text-blue-600 hover:underline">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-zinc-100 to-zinc-200 dark:from-zinc-900 dark:to-black p-4">
        <div className="w-full max-w-md bg-white dark:bg-zinc-800 rounded-2xl shadow-xl p-8 text-center">
          <div className="animate-pulse">加载中...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-zinc-100 to-zinc-200 dark:from-zinc-900 dark:to-black p-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-800 rounded-2xl shadow-xl p-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-zinc-100 dark:bg-zinc-700">
            {getStatusIcon(data.status)}
          </div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white mb-2">
            邀请状态
          </h1>
          <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(data.status)}`}>
            {getStatusLabel(data.status)}
          </span>
        </div>

        <div className="space-y-4 text-sm">
          <div className="flex justify-between py-2 border-b border-zinc-200 dark:border-zinc-700">
            <span className="text-zinc-500 dark:text-zinc-400">邮箱</span>
            <span className="text-zinc-900 dark:text-white font-medium">{data.email}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-zinc-200 dark:border-zinc-700">
            <span className="text-zinc-500 dark:text-zinc-400">创建时间</span>
            <span className="text-zinc-900 dark:text-white">{new Date(data.createdAt).toLocaleString()}</span>
          </div>
          {data.processedAt && (
            <div className="flex justify-between py-2 border-b border-zinc-200 dark:border-zinc-700">
              <span className="text-zinc-500 dark:text-zinc-400">处理时间</span>
              <span className="text-zinc-900 dark:text-white">{new Date(data.processedAt).toLocaleString()}</span>
            </div>
          )}
        </div>

        <div className="mt-6 p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg">
          <p className="text-zinc-700 dark:text-zinc-300">{data.message}</p>
        </div>

        <Link
          href="/"
          className="mt-6 block w-full py-3 px-4 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-900 dark:text-white font-medium rounded-lg transition text-center"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
}
