"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Team {
  id: string;
  name: string;
  accountId: string;
  maxMembers: number;
  currentMembers: number;
  isActive: boolean;
  expiresAt: string | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
  _count: {
    invitations: number;
  };
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

interface NewTeam {
  name: string;
  accountId: string;
  accessToken: string;
  cookies: string;
  maxMembers: number;
  expiresAt: string;
  priority: number;
}

interface EditTeam {
  id: string;
  name: string;
  accountId: string;
  accessToken: string;
  cookies: string;
  maxMembers: number;
  expiresAt: string;
  priority: number;
}

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const tzOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  const local = new Date(date.getTime() - tzOffsetMs);
  return local.toISOString().slice(0, 16);
}

function datetimeLocalToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function isExpired(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  return !Number.isNaN(time) && time <= Date.now();
}

type TeamValidityState =
  | { state: "idle" }
  | { state: "loading" }
  | {
      state: "ok";
      checkedAt: string;
      planType?: string;
      seatsAvailable?: number;
      seatsUsed?: number;
      upstreamStatus?: number;
    }
  | {
      state: "error";
      checkedAt: string;
      message: string;
      requiresCookies?: boolean;
      upstreamStatus?: number;
    };

type TeamStatusApiResponse = {
  ok?: boolean;
  checkedAt?: string;
  error?: string;
  requiresCookies?: boolean;
  upstreamStatus?: number;
  subscription?: {
    seats_available?: number;
    seats_used?: number;
    plan_type?: string;
  };
};

export default function TeamsPage() {
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newTeam, setNewTeam] = useState<NewTeam>({
    name: "",
    accountId: "",
    accessToken: "",
    cookies: "",
    maxMembers: 0,
    expiresAt: "",
    priority: 0,
  });
  const [editingTeam, setEditingTeam] = useState<EditTeam | null>(null);

  const [membersModalOpen, setMembersModalOpen] = useState(false);
  const [membersModalTeam, setMembersModalTeam] = useState<Team | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [membersTotal, setMembersTotal] = useState<number | null>(null);
  const membersFetchControllerRef = useRef<AbortController | null>(null);

  const [teamValidityById, setTeamValidityById] = useState<
    Record<string, TeamValidityState>
  >({});

  const getToken = () => localStorage.getItem("admin_token");

  const checkTeamValidity = useCallback(
    async (team: Team) => {
      const token = getToken();
      if (!token) {
        router.push("/admin");
        return;
      }

      setTeamValidityById((prev) => ({
        ...prev,
        [team.id]: { state: "loading" },
      }));

      try {
        const res = await fetch(`/api/admin/teams/${team.id}/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.status === 401) {
          localStorage.removeItem("admin_token");
          router.push("/admin");
          return;
        }

        const data = (await res
          .json()
          .catch(() => ({}))) as Partial<TeamStatusApiResponse>;

        const checkedAt =
          typeof data.checkedAt === "string"
            ? data.checkedAt
            : new Date().toISOString();

        if (res.ok && data.ok) {
          const sub = data.subscription || {};
          setTeamValidityById((prev) => ({
            ...prev,
            [team.id]: {
              state: "ok",
              checkedAt,
              planType: sub.plan_type,
              seatsAvailable: sub.seats_available,
              seatsUsed: sub.seats_used,
              upstreamStatus:
                typeof data.upstreamStatus === "number"
                  ? data.upstreamStatus
                  : undefined,
            },
          }));
          return;
        }

        setTeamValidityById((prev) => ({
          ...prev,
          [team.id]: {
            state: "error",
            checkedAt,
            message:
              typeof data.error === "string" && data.error
                ? data.error
                : "检测失败",
            requiresCookies: Boolean(data.requiresCookies),
            upstreamStatus:
              typeof data.upstreamStatus === "number"
                ? data.upstreamStatus
                : undefined,
          },
        }));
      } catch (error) {
        setTeamValidityById((prev) => ({
          ...prev,
          [team.id]: {
            state: "error",
            checkedAt: new Date().toISOString(),
            message:
              error instanceof Error ? error.message : "检测失败，请稍后重试",
          },
        }));
      }
    },
    [router]
  );

  const closeMembersModal = () => {
    membersFetchControllerRef.current?.abort();
    membersFetchControllerRef.current = null;
    setMembersModalOpen(false);
    setMembersModalTeam(null);
    setMembersLoading(false);
    setMembersError("");
    setMembers([]);
    setMembersTotal(null);
  };

  const fetchTeamMembers = useCallback(async (team: Team) => {
    const token = getToken();
    if (!token) {
      router.push("/admin");
      return;
    }

    membersFetchControllerRef.current?.abort();
    const controller = new AbortController();
    membersFetchControllerRef.current = controller;

    setMembersLoading(true);
    setMembersError("");
    setMembers([]);
    setMembersTotal(null);

    try {
      const res = await fetch(`/api/admin/teams/${team.id}/members`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });

      if (res.status === 401) {
        localStorage.removeItem("admin_token");
        router.push("/admin");
        return;
      }

      type TeamMembersApiResponse = {
        members?: TeamMember[];
        total?: number;
        error?: string;
      };

      const data = (await res
        .json()
        .catch(() => ({}))) as Partial<TeamMembersApiResponse>;

      if (membersFetchControllerRef.current !== controller) {
        return;
      }

      if (res.ok) {
        const list = Array.isArray(data.members) ? (data.members as TeamMember[]) : [];
        setMembers(list);
        setMembersTotal(
          typeof data.total === "number" ? data.total : list.length
        );
      } else {
        setMembersError(data.error || "获取成员列表失败");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setMembersError("获取成员列表失败，请稍后重试");
    } finally {
      if (membersFetchControllerRef.current === controller) {
        setMembersLoading(false);
      }
    }
  }, [router]);

  const fetchTeams = useCallback(async () => {
    const token = getToken();
    if (!token) {
      router.push("/admin");
      return;
    }

    try {
      const res = await fetch("/api/admin/teams", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        localStorage.removeItem("admin_token");
        router.push("/admin");
        return;
      }

      const data = await res.json();
      setTeams(data.teams || []);
    } catch (error) {
      console.error("Failed to fetch teams:", error);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const handleSync = async () => {
    const token = getToken();
    if (!token) return;

    setSyncing(true);
    try {
      await fetch("/api/admin/teams/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchTeams();
    } catch (error) {
      console.error("Failed to sync teams:", error);
    } finally {
      setSyncing(false);
    }
  };

  const handleAddTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = getToken();
    if (!token) return;

    setSaving(true);
    try {
      const payload = {
        ...newTeam,
        expiresAt: datetimeLocalToIso(newTeam.expiresAt),
      };

      const res = await fetch("/api/admin/teams", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setShowAddForm(false);
        setNewTeam({
          name: "",
          accountId: "",
          accessToken: "",
          cookies: "",
          maxMembers: 0,
          expiresAt: "",
          priority: 0,
        });
        await fetchTeams();
      } else {
        const data = await res.json();
        alert(data.error || "添加失败");
      }
    } catch (error) {
      console.error("Failed to add team:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (team: Team) => {
    const token = getToken();
    if (!token) return;

    try {
      await fetch("/api/admin/teams", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: team.id,
          isActive: !team.isActive,
        }),
      });
      await fetchTeams();
    } catch (error) {
      console.error("Failed to update team:", error);
    }
  };

  const handleStartEdit = (team: Team) => {
    setEditingTeam({
      id: team.id,
      name: team.name,
      accountId: team.accountId,
      accessToken: "",
      cookies: "",
      maxMembers: team.maxMembers,
      expiresAt: toDatetimeLocalValue(team.expiresAt),
      priority: team.priority,
    });
    setShowAddForm(false);
  };

  const handleEditTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = getToken();
    if (!token || !editingTeam) return;

    setSaving(true);
    try {
      const updateData: Record<string, unknown> = {
        id: editingTeam.id,
        name: editingTeam.name,
        accountId: editingTeam.accountId,
        maxMembers: editingTeam.maxMembers,
        expiresAt: datetimeLocalToIso(editingTeam.expiresAt),
        priority: editingTeam.priority,
      };

      // Only update tokens if provided
      if (editingTeam.accessToken) {
        updateData.accessToken = editingTeam.accessToken;
      }
      if (editingTeam.cookies) {
        updateData.cookies = editingTeam.cookies;
      }

      const res = await fetch("/api/admin/teams", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updateData),
      });

      if (res.ok) {
        setEditingTeam(null);
        await fetchTeams();
      } else {
        const data = await res.json();
        alert(data.error || "更新失败");
      }
    } catch (error) {
      console.error("Failed to update team:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const token = getToken();
    if (!token) return;

    if (!confirm("确定要删除此团队吗？")) return;

    try {
      await fetch("/api/admin/teams", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });
      await fetchTeams();
    } catch (error) {
      console.error("Failed to delete team:", error);
    }
  };

  const handleViewMembers = async (team: Team) => {
    setMembersModalTeam(team);
    setMembersModalOpen(true);
    await fetchTeamMembers(team);
  };

  const renderTeamValidity = (team: Team) => {
    const state = teamValidityById[team.id];
    if (!state || state.state === "idle") {
      return (
        <span className="px-2 py-1 rounded text-xs font-medium bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-300">
          未检测
        </span>
      );
    }

    if (state.state === "loading") {
      return (
        <span className="px-2 py-1 rounded text-xs font-medium bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-300">
          检测中...
        </span>
      );
    }

    if (state.state === "ok") {
      const hasSeatInfo =
        typeof state.seatsUsed === "number" ||
        typeof state.seatsAvailable === "number";
      return (
        <div className="flex flex-col gap-1">
          <span className="px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 w-fit">
            有效
          </span>
          {hasSeatInfo && (
            <span className="text-xs text-zinc-600 dark:text-zinc-300">
              已用 {state.seatsUsed ?? "-"} / 可用 {state.seatsAvailable ?? "-"}
            </span>
          )}
          {state.planType && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {state.planType}
            </span>
          )}
        </div>
      );
    }

    const badgeClass = state.requiresCookies
      ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300"
      : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
    const label = state.requiresCookies ? "需 Cookies" : "无效";
    return (
      <div className="flex flex-col gap-1">
        <span className={`px-2 py-1 rounded text-xs font-medium w-fit ${badgeClass}`}>
          {label}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400 break-words">
          {state.message}
        </span>
      </div>
    );
  };

  const getCapacityBadge = (team: Team) => {
    if (team.maxMembers === 0) {
      return (
        <span className="px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300">
          无限制
        </span>
      );
    }

    const percentage = (team.currentMembers / team.maxMembers) * 100;
    if (percentage >= 100) {
      return (
        <span className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300">
          已满
        </span>
      );
    } else if (percentage >= 80) {
      return (
        <span className="px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300">
          即将满员
        </span>
      );
    } else {
      return (
        <span className="px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
          可用
        </span>
      );
    }
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
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">
              ← 返回仪表板
            </Link>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-white">团队管理</h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-4 py-2 text-sm bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-900 dark:text-white rounded-lg transition disabled:opacity-50"
            >
              {syncing ? "同步中..." : "同步成员数"}
            </button>
            <button
              onClick={() => setShowAddForm(true)}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
            >
              添加团队
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 shadow">
            <div className="text-2xl font-bold text-zinc-900 dark:text-white">{teams.length}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">团队总数</div>
          </div>
          <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 shadow">
            <div className="text-2xl font-bold text-green-600">{teams.filter(t => t.isActive).length}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">已启用</div>
          </div>
          <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 shadow">
            <div className="text-2xl font-bold text-blue-600">{teams.reduce((a, t) => a + t.currentMembers, 0)}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">总成员数</div>
          </div>
          <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 shadow">
            <div className="text-2xl font-bold text-purple-600">
              {teams.filter(t => t.maxMembers === 0 || t.currentMembers < t.maxMembers).length}
            </div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">有空位团队</div>
          </div>
        </div>

        {/* Add Team Form */}
        {showAddForm && (
          <div className="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow mb-8">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4">添加新团队</h2>
            <form onSubmit={handleAddTeam} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    团队名称 *
                  </label>
                  <input
                    type="text"
                    value={newTeam.name}
                    onChange={(e) => setNewTeam({ ...newTeam, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Account ID *
                  </label>
                  <input
                    type="text"
                    value={newTeam.accountId}
                    onChange={(e) => setNewTeam({ ...newTeam, accountId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white font-mono text-sm"
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    required
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Access Token *
                  </label>
                  <input
                    type="password"
                    value={newTeam.accessToken}
                    onChange={(e) => setNewTeam({ ...newTeam, accessToken: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white font-mono text-sm"
                    required
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Cookies (可选)
                  </label>
                  <input
                    type="text"
                    value={newTeam.cookies}
                    onChange={(e) => setNewTeam({ ...newTeam, cookies: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white font-mono text-sm"
                    placeholder="用于绕过 Cloudflare 验证"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    成员上限 (0=无限制)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={newTeam.maxMembers}
                    onChange={(e) => setNewTeam({ ...newTeam, maxMembers: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    到期时间 (留空=永不过期)
                  </label>
                  <input
                    type="datetime-local"
                    value={newTeam.expiresAt}
                    onChange={(e) =>
                      setNewTeam({ ...newTeam, expiresAt: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    优先级 (数字越小越优先)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={newTeam.priority}
                    onChange={(e) => setNewTeam({ ...newTeam, priority: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white"
                  />
                </div>
              </div>
              <div className="flex gap-4">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition"
                >
                  {saving ? "保存中..." : "保存"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-6 py-2 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-900 dark:text-white font-medium rounded-lg transition"
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Edit Team Form */}
        {editingTeam && (
          <div className="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow mb-8">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4">编辑团队</h2>
            <form onSubmit={handleEditTeam} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    团队名称 *
                  </label>
                  <input
                    type="text"
                    value={editingTeam.name}
                    onChange={(e) => setEditingTeam({ ...editingTeam, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Account ID *
                  </label>
                  <input
                    type="text"
                    value={editingTeam.accountId}
                    onChange={(e) => setEditingTeam({ ...editingTeam, accountId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white font-mono text-sm"
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    required
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Access Token (留空保持不变)
                  </label>
                  <input
                    type="password"
                    value={editingTeam.accessToken}
                    onChange={(e) => setEditingTeam({ ...editingTeam, accessToken: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white font-mono text-sm"
                    placeholder="留空则保持原有 Token"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Cookies (留空保持不变)
                  </label>
                  <input
                    type="text"
                    value={editingTeam.cookies}
                    onChange={(e) => setEditingTeam({ ...editingTeam, cookies: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white font-mono text-sm"
                    placeholder="留空则保持原有 Cookies"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    成员上限 (0=无限制)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editingTeam.maxMembers}
                    onChange={(e) => setEditingTeam({ ...editingTeam, maxMembers: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    到期时间 (留空=永不过期)
                  </label>
                  <input
                    type="datetime-local"
                    value={editingTeam.expiresAt}
                    onChange={(e) =>
                      setEditingTeam({ ...editingTeam, expiresAt: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    优先级 (数字越小越优先)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editingTeam.priority}
                    onChange={(e) => setEditingTeam({ ...editingTeam, priority: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white"
                  />
                </div>
              </div>
              <div className="flex gap-4">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition"
                >
                  {saving ? "保存中..." : "保存修改"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingTeam(null)}
                  className="px-6 py-2 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-900 dark:text-white font-medium rounded-lg transition"
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Teams Table */}
        <div className="bg-white dark:bg-zinc-800 rounded-xl shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">团队列表</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
	              <thead className="bg-zinc-50 dark:bg-zinc-700/50">
	                <tr>
	                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">团队名称</th>
	                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">成员/上限</th>
	                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">状态</th>
	                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">有效性</th>
	                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">到期时间</th>
	                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">优先级</th>
	                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">邀请数</th>
	                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">操作</th>
	                </tr>
	              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                {teams.map((team) => (
                  <tr key={team.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/50">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-zinc-900 dark:text-white">{team.name}</div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">{team.accountId.slice(0, 8)}...</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-zinc-900 dark:text-white">
                          {team.currentMembers} / {team.maxMembers === 0 ? "∞" : team.maxMembers}
                        </span>
                        {getCapacityBadge(team)}
                      </div>
                    </td>
	                    <td className="px-6 py-4">
	                      <button
	                        onClick={() => handleToggleActive(team)}
	                        className={`px-2 py-1 rounded text-xs font-medium ${
	                          team.isActive
	                            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
	                            : "bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-300"
	                      }`}
	                      >
	                        {team.isActive ? "已启用" : "已禁用"}
	                      </button>
	                    </td>
	                    <td className="px-6 py-4">{renderTeamValidity(team)}</td>
	                    <td className="px-6 py-4">
	                      {team.expiresAt ? (
	                        <div className="flex flex-col gap-1">
	                          <span
	                            className={`text-sm ${
	                              isExpired(team.expiresAt)
	                                ? "text-red-600 dark:text-red-400"
	                                : "text-zinc-600 dark:text-zinc-300"
	                            }`}
	                          >
	                            {new Date(team.expiresAt).toLocaleString()}
	                          </span>
	                          {isExpired(team.expiresAt) && (
	                            <span className="inline-block w-fit px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300">
	                              已过期
	                            </span>
	                          )}
	                        </div>
	                      ) : (
	                        <span className="text-sm text-zinc-600 dark:text-zinc-300">
	                          永不过期
	                        </span>
	                      )}
	                    </td>
	                    <td className="px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
	                      {team.priority}
	                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {team._count.invitations}
                    </td>
	                    <td className="px-6 py-4">
	                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => checkTeamValidity(team)}
                          disabled={teamValidityById[team.id]?.state === "loading"}
                          className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white disabled:opacity-50"
                        >
                          检测
                        </button>
	                        <button
	                          onClick={() => handleViewMembers(team)}
	                          className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
	                        >
	                          查看成员
                        </button>
                        <button
                          onClick={() => handleStartEdit(team)}
                          className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDelete(team.id)}
                          className="text-sm text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {teams.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-8 text-center text-zinc-500 dark:text-zinc-400">
                      暂无团队，点击“添加团队”开始配置
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Help */}
        <div className="mt-8 bg-blue-50 dark:bg-blue-900/20 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-2">使用说明</h3>
          <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1 list-disc list-inside">
            <li>添加多个 ChatGPT Team 账户，系统会自动分配邀请到未满的团队</li>
            <li>优先级数字越小，优先使用该团队（0 为最高优先级）</li>
            <li>成员上限设为 0 表示无限制</li>
            <li>设置“到期时间”后，到期的团队将不再接收新邀请（留空表示永不过期）</li>
            <li>点击“检测”可实时检查团队凭据有效性（可能受到 Cloudflare/限流影响）</li>
            <li>点击“同步成员数”可从 ChatGPT API 同步实际成员数量</li>
            <li>禁用的团队不会接收新邀请</li>
          </ul>
        </div>
      </main>

      {/* Members Modal */}
      {membersModalOpen && membersModalTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={closeMembersModal}
          />
          <div className="relative w-full max-w-5xl bg-white dark:bg-zinc-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
                  成员列表：{membersModalTeam.name}
                </h2>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {membersTotal !== null ? `共 ${membersTotal} 人` : " "}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => fetchTeamMembers(membersModalTeam)}
                  disabled={membersLoading}
                  className="px-3 py-1.5 text-sm bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-900 dark:text-white rounded-lg transition disabled:opacity-50"
                >
                  {membersLoading ? "加载中..." : "刷新"}
                </button>
                <button
                  onClick={closeMembersModal}
                  className="px-3 py-1.5 text-sm bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-900 dark:text-white rounded-lg transition"
                >
                  关闭
                </button>
              </div>
            </div>

            <div className="p-6">
              {membersLoading && (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  正在获取成员列表...
                </div>
              )}

              {!membersLoading && membersError && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
                  <div className="text-sm text-red-700 dark:text-red-300">
                    {membersError}
                  </div>
                  <button
                    onClick={() => fetchTeamMembers(membersModalTeam)}
                    className="mt-3 px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition"
                  >
                    重试
                  </button>
                </div>
              )}

              {!membersLoading && !membersError && (
                <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                  <div className="max-h-[65vh] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-50 dark:bg-zinc-700/50 sticky top-0">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">
                            姓名
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">
                            邮箱
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">
                            角色
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">
                            加入时间
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">
                            ID
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                        {members.map((member) => (
                          <tr
                            key={member.id}
                            className="hover:bg-zinc-50 dark:hover:bg-zinc-700/50"
                          >
                            <td className="px-4 py-3 text-zinc-900 dark:text-white">
                              {member.name || "未设置"}
                            </td>
                            <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300 font-mono text-xs">
                              {member.email}
                            </td>
                            <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                              {member.role}
                            </td>
                            <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                              {member.createdAt
                                ? new Date(member.createdAt).toLocaleString()
                                : "-"}
                            </td>
                            <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400 font-mono text-xs">
                              {member.id}
                            </td>
                          </tr>
                        ))}
                        {members.length === 0 && (
                          <tr>
                            <td
                              colSpan={5}
                              className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-400"
                            >
                              暂无成员信息
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
