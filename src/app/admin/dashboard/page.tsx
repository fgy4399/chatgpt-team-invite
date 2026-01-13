"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface InviteCode {
  id: string;
  code: string;
  status: string;
  note?: string;
  createdAt: string;
  expiresAt?: string;
  invitation?: {
    email: string;
    status: string;
    createdAt: string;
  };
}

interface Stats {
  total: number;
  pending: number;
  used: number;
  expired: number;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, pending: 0, used: 0, expired: 0 });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateCount, setGenerateCount] = useState(1);

  const getToken = () => localStorage.getItem("admin_token");

  const fetchCodes = useCallback(async () => {
    const token = getToken();
    if (!token) {
      router.push("/admin");
      return;
    }

    try {
      const res = await fetch("/api/admin/codes", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        localStorage.removeItem("admin_token");
        router.push("/admin");
        return;
      }

      const data = await res.json();
      setCodes(data.codes || []);

      if (data.stats) {
        setStats(data.stats);
      } else {
        // Fallback: 仅基于当前页数据统计（兼容旧接口）
        const allCodes = data.codes || [];
        setStats({
          total: allCodes.length,
          pending: allCodes.filter((c: InviteCode) => c.status === "PENDING").length,
          used: allCodes.filter((c: InviteCode) => c.status === "USED").length,
          expired: allCodes.filter((c: InviteCode) => c.status === "EXPIRED" || c.status === "REVOKED").length,
        });
      }
    } catch (error) {
      console.error("Failed to fetch codes:", error);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchCodes();
  }, [fetchCodes]);

  const handleGenerate = async () => {
    const token = getToken();
    if (!token) return;

    setGenerating(true);
    try {
      const res = await fetch("/api/admin/codes/generate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ count: generateCount }),
      });

      if (res.ok) {
        await fetchCodes();
      }
    } catch (error) {
      console.error("Failed to generate codes:", error);
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    const token = getToken();
    if (!token) return;

    if (!confirm("您确定要撤销此邀请码吗？")) return;

    try {
      await fetch("/api/admin/codes", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });
      await fetchCodes();
    } catch (error) {
      console.error("Failed to revoke code:", error);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_username");
    router.push("/admin");
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      PENDING: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      USED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
      EXPIRED: "bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-300",
      REVOKED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    };
    const labels: Record<string, string> = {
      PENDING: "待使用",
      USED: "已使用",
      EXPIRED: "已过期",
      REVOKED: "已撤销",
    };
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status] || colors.PENDING}`}>
        {labels[status] || status}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-900">
        <div className="animate-pulse text-zinc-600 dark:text-zinc-400">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900">
      {/* Header */}
      <header className="bg-white dark:bg-zinc-800 shadow">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white">管理后台</h1>
          <div className="flex items-center gap-4">
            <Link href="/admin/teams" className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
              团队管理
            </Link>
            <Link href="/" className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">
              查看网站
            </Link>
            <button
              onClick={handleLogout}
              className="text-sm text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
            >
              退出登录
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 shadow">
            <div className="text-2xl font-bold text-zinc-900 dark:text-white">{stats.total}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">邀请码总计</div>
          </div>
          <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 shadow">
            <div className="text-2xl font-bold text-green-600">{stats.pending}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">可用</div>
          </div>
          <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 shadow">
            <div className="text-2xl font-bold text-blue-600">{stats.used}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">已使用</div>
          </div>
          <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 shadow">
            <div className="text-2xl font-bold text-zinc-500">{stats.expired}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">已过期/已撤销</div>
          </div>
        </div>

        {/* Generate Section */}
        <div className="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow mb-8">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4">生成邀请码</h2>
          <div className="flex gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                生成数量
              </label>
              <input
                type="number"
                min="1"
                max="100"
                value={generateCount}
                onChange={(e) => setGenerateCount(parseInt(e.target.value) || 1)}
                className="w-24 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white"
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition"
            >
              {generating ? "生成中..." : "生成"}
            </button>
          </div>
        </div>

        {/* Codes Table */}
        <div className="bg-white dark:bg-zinc-800 rounded-xl shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">邀请码列表</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-50 dark:bg-zinc-700/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">邀请码</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">状态</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">使用者</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">创建时间</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                {codes.map((code) => (
                  <tr key={code.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-mono text-zinc-900 dark:text-white">{code.code}</code>
                        <button
                          onClick={() => copyToClipboard(code.code)}
                          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                          title="复制"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4">{getStatusBadge(code.status)}</td>
                    <td className="px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {code.invitation?.email || "-"}
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {new Date(code.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      {code.status === "PENDING" && (
                        <button
                          onClick={() => handleRevoke(code.id)}
                          className="text-sm text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                        >
                          撤销
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {codes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-zinc-500 dark:text-zinc-400">
                      暂无邀请码，请在上方生成！
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
