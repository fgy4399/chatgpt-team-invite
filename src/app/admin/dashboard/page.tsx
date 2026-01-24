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
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const getToken = () => localStorage.getItem("admin_token");

  const fetchCodes = useCallback(async () => {
    const token = getToken();
    if (!token) {
      router.push("/admin");
      return;
    }

    try {
      const res = await fetch(`/api/admin/codes?page=${page}&limit=${limit}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        localStorage.removeItem("admin_token");
        router.push("/admin");
        return;
      }

      const data = await res.json();
      setCodes(data.codes || []);
      setTotal(typeof data.total === "number" ? data.total : 0);
      setTotalPages(typeof data.totalPages === "number" ? data.totalPages : 1);

      if (data.stats) {
        setStats(data.stats);
      } else {
        // 兜底：仅基于当前页数据统计（兼容旧接口）
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
  }, [router, page, limit]);

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
        if (page !== 1) {
          setPage(1);
        } else {
          await fetchCodes();
        }
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

  const getInvitationBadge = (status?: string) => {
    if (!status) {
      return (
        <span className="px-2 py-1 rounded text-xs font-medium bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          -
        </span>
      );
    }

    const colors: Record<string, string> = {
      PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
      SUCCESS: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      FAILED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    };
    const labels: Record<string, string> = {
      PENDING: "处理中",
      SUCCESS: "已发送",
      FAILED: "失败",
    };

    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status] || colors.PENDING}`}>
        {labels[status] || status}
      </span>
    );
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      PENDING: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      USED: "bg-violet-100 text-violet-900 dark:bg-violet-500/15 dark:text-violet-200",
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
      <div className="min-h-screen bg-linear-to-br from-violet-50 via-white to-violet-100 dark:from-zinc-950 dark:via-zinc-950 dark:to-violet-950/40 p-4 flex items-center justify-center">
        <div className="w-full max-w-md rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow-xl p-8 text-center">
          <div className="flex items-center justify-center gap-3 text-sm text-zinc-600 dark:text-zinc-300">
            <svg className="animate-spin h-5 w-5 text-violet-600" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            正在加载后台数据...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-violet-50 via-white to-violet-100 dark:from-zinc-950 dark:via-zinc-950 dark:to-violet-950/40">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-violet-200/50 dark:border-violet-500/20 bg-white/70 dark:bg-zinc-900/50 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white shadow">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h18v4H3V3zM3 10h18v11H3V10z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 14h4m-4 3h10" />
              </svg>
            </span>
            <div>
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-white">管理后台</h1>
              <div className="text-xs text-zinc-600 dark:text-zinc-300">
                邀请码管理 · 数据概览
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/teams"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-violet-200/70 dark:border-violet-500/25 bg-white/70 dark:bg-zinc-900/40 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-900/60 transition-colors"
            >
              团队管理
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors"
            >
              查看网站
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7-7 7M3 12h17" />
              </svg>
            </Link>
            <button
              onClick={handleLogout}
              className="inline-flex items-center px-3 py-2 rounded-xl text-sm text-red-700 hover:text-red-900 dark:text-red-300 dark:hover:text-red-200 transition-colors"
            >
              退出登录
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow p-5">
            <div className="text-2xl font-bold text-zinc-900 dark:text-white">{stats.total}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">邀请码总计</div>
          </div>
          <div className="rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow p-5">
            <div className="text-2xl font-bold text-green-600">{stats.pending}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">可用</div>
          </div>
          <div className="rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow p-5">
            <div className="text-2xl font-bold text-violet-700 dark:text-violet-300">{stats.used}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">已使用</div>
          </div>
          <div className="rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow p-5">
            <div className="text-2xl font-bold text-zinc-500">{stats.expired}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">已过期/已撤销</div>
          </div>
        </div>

        {/* Generate Section */}
        <div className="rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow p-6 mb-8">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-1">生成邀请码</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-5">
            批量生成后可复制并分发给用户
          </p>
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
                className="w-28 px-4 py-2.5 rounded-xl border border-zinc-300/80 dark:border-zinc-700 bg-white/90 dark:bg-zinc-800/80 text-zinc-900 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-medium rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-zinc-900"
            >
              {generating ? "生成中..." : "生成"}
            </button>
          </div>
        </div>

        {/* Codes Table */}
        <div className="rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200/70 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">邀请码列表</h2>
            <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-300">
              <span>共 {total} 条</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">每页</span>
                <select
                  value={limit}
                  onChange={(e) => {
                    const next = parseInt(e.target.value) || 50;
                    setLimit(next);
                    setPage(1);
                  }}
                  className="px-3 py-2 rounded-xl border border-zinc-300/80 dark:border-zinc-700 bg-white/90 dark:bg-zinc-800/80 text-zinc-900 dark:text-white text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-violet-50/70 dark:bg-violet-500/10">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">邀请码</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">状态</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">使用者</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">邀请状态</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">创建时间</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800">
                {codes.map((code) => (
                  <tr key={code.id} className="hover:bg-violet-50/50 dark:hover:bg-violet-500/10 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-mono text-zinc-900 dark:text-white">{code.code}</code>
                        <button
                          onClick={() => copyToClipboard(code.code)}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 hover:text-zinc-900 hover:bg-white dark:text-zinc-300 dark:hover:text-white dark:hover:bg-zinc-900/40 transition-colors"
                          aria-label="复制邀请码"
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
                    <td className="px-6 py-4">
                      {getInvitationBadge(code.invitation?.status)}
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {new Date(code.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      {code.status === "PENDING" && (
                        <button
                          onClick={() => handleRevoke(code.id)}
                          className="text-sm text-red-700 hover:text-red-900 dark:text-red-300 dark:hover:text-red-200 transition-colors"
                        >
                          撤销
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {codes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-zinc-600 dark:text-zinc-400">
                      暂无邀请码，请在上方生成！
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 border-t border-zinc-200/70 dark:border-zinc-800 flex items-center justify-between gap-3">
            <div className="text-sm text-zinc-600 dark:text-zinc-300">
              第 {page} / {totalPages} 页
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                className="px-4 py-2 rounded-xl border border-violet-200/70 dark:border-violet-500/25 bg-white/70 dark:bg-zinc-900/40 text-sm text-zinc-900 dark:text-white hover:bg-white dark:hover:bg-zinc-900/60 transition-colors disabled:opacity-50"
              >
                上一页
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}
                className="px-4 py-2 rounded-xl border border-violet-200/70 dark:border-violet-500/25 bg-white/70 dark:bg-zinc-900/40 text-sm text-zinc-900 dark:text-white hover:bg-white dark:hover:bg-zinc-900/60 transition-colors disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
