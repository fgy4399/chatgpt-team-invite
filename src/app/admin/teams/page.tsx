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
  priority: number;
}

interface EditTeam {
  id: string;
  name: string;
  accountId: string;
  accessToken: string;
  cookies: string;
  maxMembers: number;
  priority: number;
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
    priority: 0,
  });
  const [editingTeam, setEditingTeam] = useState<EditTeam | null>(null);

  const [membersModalOpen, setMembersModalOpen] = useState(false);
  const [membersModalTeam, setMembersModalTeam] = useState<Team | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [membersTotal, setMembersTotal] = useState<number | null>(null);
  const [kickSubmittingId, setKickSubmittingId] = useState<string | null>(null);
  const [kickError, setKickError] = useState("");
  const membersFetchControllerRef = useRef<AbortController | null>(null);

  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteModalTeam, setInviteModalTeam] = useState<Team | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [syncingTeamIds, setSyncingTeamIds] = useState<Record<string, boolean>>(
    {}
  );

  const [teamValidityById, setTeamValidityById] = useState<
    Record<string, TeamValidityState>
  >({});

  const getToken = () => localStorage.getItem("admin_token");

  const openInviteModal = (team: Team) => {
    setInviteModalTeam(team);
    setInviteModalOpen(true);
    setInviteEmail("");
    setInviteError("");
    setInviteSuccess("");
    setInviteSubmitting(false);
  };

  const closeInviteModal = useCallback(() => {
    setInviteModalOpen(false);
    setInviteModalTeam(null);
    setInviteEmail("");
    setInviteError("");
    setInviteSuccess("");
    setInviteSubmitting(false);
  }, []);

  const submitManualInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const team = inviteModalTeam;
    if (!team) return;

    const token = getToken();
    if (!token) {
      router.push("/admin");
      return;
    }

    const email = inviteEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInviteError("邮箱格式无效");
      return;
    }

    setInviteSubmitting(true);
    setInviteError("");
    setInviteSuccess("");

    try {
      const res = await fetch(`/api/admin/teams/${team.id}/invite`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      if (res.status === 401) {
        localStorage.removeItem("admin_token");
        router.push("/admin");
        return;
      }

      type ManualInviteApiResponse = {
        success?: boolean;
        message?: string;
        error?: string;
      };

      const data = (await res
        .json()
        .catch(() => ({}))) as Partial<ManualInviteApiResponse>;

      if (res.ok && data.success) {
        setInviteSuccess(data.message || "邀请已发送成功！");
        setInviteEmail("");
        await fetchTeams();
      } else {
        setInviteError(data.error || "发送邀请失败");
      }
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : "发送邀请失败");
    } finally {
      setInviteSubmitting(false);
    }
  };

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

  const closeMembersModal = useCallback(() => {
    membersFetchControllerRef.current?.abort();
    membersFetchControllerRef.current = null;
    setMembersModalOpen(false);
    setMembersModalTeam(null);
    setMembersLoading(false);
    setMembersError("");
    setMembers([]);
    setMembersTotal(null);
    setKickSubmittingId(null);
    setKickError("");
  }, []);

  useEffect(() => {
    if (!inviteModalOpen && !membersModalOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;

      if (inviteModalOpen) closeInviteModal();
      if (membersModalOpen) closeMembersModal();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [inviteModalOpen, membersModalOpen, closeInviteModal, closeMembersModal]);

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
    setKickError("");
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

  const handleSyncTeam = async (team: Team) => {
    const token = getToken();
    if (!token) return;

    setSyncingTeamIds((prev) => ({ ...prev, [team.id]: true }));

    try {
      const res = await fetch(`/api/admin/teams/${team.id}/sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        localStorage.removeItem("admin_token");
        router.push("/admin");
        return;
      }

      type SyncTeamApiResponse = {
        success?: boolean;
        currentMembers?: number;
        error?: string;
      };

      const data = (await res
        .json()
        .catch(() => ({}))) as Partial<SyncTeamApiResponse>;

      if (!res.ok) {
        alert(data.error || "同步成员数失败");
        return;
      }

      const nextCount =
        typeof data.currentMembers === "number"
          ? data.currentMembers
          : team.currentMembers;

      setTeams((prev) =>
        prev.map((item) =>
          item.id === team.id ? { ...item, currentMembers: nextCount } : item
        )
      );
      setInviteModalTeam((prev) =>
        prev && prev.id === team.id
          ? { ...prev, currentMembers: nextCount }
          : prev
      );
      setMembersModalTeam((prev) =>
        prev && prev.id === team.id
          ? { ...prev, currentMembers: nextCount }
          : prev
      );
      setMembersTotal((prev) =>
        membersModalTeam?.id === team.id && prev !== null ? nextCount : prev
      );
    } catch (error) {
      alert(error instanceof Error ? error.message : "同步成员数失败");
    } finally {
      setSyncingTeamIds((prev) => ({ ...prev, [team.id]: false }));
    }
  };

  const handleAddTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = getToken();
    if (!token) return;

    setSaving(true);
    try {
      const res = await fetch("/api/admin/teams", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newTeam),
      });

      if (res.ok) {
        setShowAddForm(false);
        setNewTeam({
          name: "",
          accountId: "",
          accessToken: "",
          cookies: "",
          maxMembers: 0,
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
    setKickError("");
    await fetchTeamMembers(team);
  };

  const handleKickMember = async (member: TeamMember) => {
    const team = membersModalTeam;
    if (!team) return;

    const token = getToken();
    if (!token) {
      router.push("/admin");
      return;
    }

    if (!confirm(`确定要将 ${member.email} 移出该团队吗？`)) return;

    setKickSubmittingId(member.id);
    setKickError("");

    try {
      const res = await fetch(
        `/api/admin/teams/${team.id}/members/${member.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (res.status === 401) {
        localStorage.removeItem("admin_token");
        router.push("/admin");
        return;
      }

      type KickMemberApiResponse = {
        success?: boolean;
        error?: string;
        requiresCookies?: boolean;
        currentMembers?: number;
      };

      const data = (await res
        .json()
        .catch(() => ({}))) as Partial<KickMemberApiResponse>;

      if (!res.ok) {
        setKickError(data.error || "踢出成员失败");
        return;
      }

      const nextCount =
        typeof data.currentMembers === "number"
          ? data.currentMembers
          : Math.max(team.currentMembers - 1, 0);

      setMembers((prev) => prev.filter((item) => item.id !== member.id));
      setMembersTotal((prev) =>
        typeof prev === "number" ? Math.max(prev - 1, 0) : prev
      );
      setTeams((prev) =>
        prev.map((item) =>
          item.id === team.id ? { ...item, currentMembers: nextCount } : item
        )
      );
      setMembersModalTeam((prev) =>
        prev && prev.id === team.id
          ? { ...prev, currentMembers: nextCount }
          : prev
      );
      setInviteModalTeam((prev) =>
        prev && prev.id === team.id
          ? { ...prev, currentMembers: nextCount }
          : prev
      );
    } catch (error) {
      setKickError(
        error instanceof Error ? error.message : "踢出成员失败，请稍后重试"
      );
    } finally {
      setKickSubmittingId(null);
    }
  };

  const renderTeamValidity = (team: Team) => {
    const state = teamValidityById[team.id];
    if (!state || state.state === "idle") {
      return (
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-violet-50 text-violet-900 dark:bg-violet-500/10 dark:text-violet-200">
          未检测
        </span>
      );
    }

    if (state.state === "loading") {
      return (
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-violet-50 text-violet-900 dark:bg-violet-500/10 dark:text-violet-200">
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
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-violet-100 text-violet-900 dark:bg-violet-500/15 dark:text-violet-200">
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
        <span className="px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300 whitespace-pre-line text-center leading-4">
          {"即将\n满员"}
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
      <div className="min-h-screen bg-linear-to-br from-violet-50 via-white to-violet-100 dark:from-zinc-950 dark:via-zinc-950 dark:to-violet-950/40 p-4 flex items-center justify-center">
        <div className="w-full max-w-md rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow-xl p-8 text-center">
          <div className="flex items-center justify-center gap-3 text-sm text-zinc-600 dark:text-zinc-300">
            <svg className="animate-spin h-5 w-5 text-violet-600" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            正在加载团队列表...
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
            <Link
              href="/admin/dashboard"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-violet-200/70 dark:border-violet-500/25 bg-white/70 dark:bg-zinc-900/40 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-900/60 transition-colors"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              返回
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-white">团队管理</h1>
              <div className="text-xs text-zinc-600 dark:text-zinc-300">
                团队配置 · 到期 · 有效性 · 成员 · 邀请
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm rounded-xl border border-violet-200/70 dark:border-violet-500/25 bg-white/70 dark:bg-zinc-900/40 text-zinc-900 dark:text-white hover:bg-white dark:hover:bg-zinc-900/60 transition-colors disabled:opacity-50"
            >
              {syncing && (
                <svg className="animate-spin h-4 w-4 text-violet-600" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {syncing ? "同步中..." : "同步全部"}
            </button>
            <button
              onClick={() => setShowAddForm(true)}
              className="inline-flex items-center px-4 py-2.5 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-zinc-900"
            >
              添加团队
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow p-5">
            <div className="text-2xl font-bold text-zinc-900 dark:text-white">{teams.length}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">团队总数</div>
          </div>
          <div className="rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow p-5">
            <div className="text-2xl font-bold text-green-600">{teams.filter(t => t.isActive).length}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">已启用</div>
          </div>
          <div className="rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow p-5">
            <div className="text-2xl font-bold text-violet-700 dark:text-violet-300">{teams.reduce((a, t) => a + t.currentMembers, 0)}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">总成员数</div>
          </div>
          <div className="rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow p-5">
            <div className="text-2xl font-bold text-orange-600 dark:text-orange-300">
              {teams.filter(t => t.maxMembers === 0 || t.currentMembers < t.maxMembers).length}
            </div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">有空位团队</div>
          </div>
        </div>

        {/* Add Team Form */}
        {showAddForm && (
          <div className="rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow p-6 mb-8">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-1">添加新团队</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-5">
              配置账号凭据、名额上限与优先级；到期时间将自动获取
            </p>
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
                    className="w-full px-4 py-2.5 rounded-xl border border-zinc-300/80 dark:border-zinc-700 bg-white/90 dark:bg-zinc-800/80 text-zinc-900 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
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
                    className="w-full px-4 py-2.5 rounded-xl border border-zinc-300/80 dark:border-zinc-700 bg-white/90 dark:bg-zinc-800/80 text-zinc-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
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
                    className="w-full px-4 py-2.5 rounded-xl border border-zinc-300/80 dark:border-zinc-700 bg-white/90 dark:bg-zinc-800/80 text-zinc-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
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
                    className="w-full px-4 py-2.5 rounded-xl border border-zinc-300/80 dark:border-zinc-700 bg-white/90 dark:bg-zinc-800/80 text-zinc-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
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
                    className="w-full px-4 py-2.5 rounded-xl border border-zinc-300/80 dark:border-zinc-700 bg-white/90 dark:bg-zinc-800/80 text-zinc-900 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
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
                    className="w-full px-4 py-2.5 rounded-xl border border-zinc-300/80 dark:border-zinc-700 bg-white/90 dark:bg-zinc-800/80 text-zinc-900 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
                  />
                </div>
              </div>
              <div className="flex gap-4">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-medium rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-zinc-900"
                >
                  {saving ? "保存中..." : "保存"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-6 py-2.5 rounded-xl border border-violet-200/70 dark:border-violet-500/25 bg-white/70 dark:bg-zinc-900/40 text-zinc-900 dark:text-white hover:bg-white dark:hover:bg-zinc-900/60 font-medium transition-colors"
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Edit Team Form */}
        {editingTeam && (
          <div className="rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow p-6 mb-8">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-1">编辑团队</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-5">
              修改团队信息后会影响后续邀请分配与状态检测
            </p>
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
                    className="w-full px-4 py-2.5 rounded-xl border border-zinc-300/80 dark:border-zinc-700 bg-white/90 dark:bg-zinc-800/80 text-zinc-900 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
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
                    className="w-full px-4 py-2.5 rounded-xl border border-zinc-300/80 dark:border-zinc-700 bg-white/90 dark:bg-zinc-800/80 text-zinc-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
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
                    className="w-full px-4 py-2.5 rounded-xl border border-zinc-300/80 dark:border-zinc-700 bg-white/90 dark:bg-zinc-800/80 text-zinc-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
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
                    className="w-full px-4 py-2.5 rounded-xl border border-zinc-300/80 dark:border-zinc-700 bg-white/90 dark:bg-zinc-800/80 text-zinc-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
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
                    className="w-full px-4 py-2.5 rounded-xl border border-zinc-300/80 dark:border-zinc-700 bg-white/90 dark:bg-zinc-800/80 text-zinc-900 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
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
                    className="w-full px-4 py-2.5 rounded-xl border border-zinc-300/80 dark:border-zinc-700 bg-white/90 dark:bg-zinc-800/80 text-zinc-900 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
                  />
                </div>
              </div>
              <div className="flex gap-4">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-medium rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-zinc-900"
                >
                  {saving ? "保存中..." : "保存修改"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingTeam(null)}
                  className="px-6 py-2.5 rounded-xl border border-violet-200/70 dark:border-violet-500/25 bg-white/70 dark:bg-zinc-900/40 text-zinc-900 dark:text-white hover:bg-white dark:hover:bg-zinc-900/60 font-medium transition-colors"
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Teams Table */}
        <div className="rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200/70 dark:border-zinc-800">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">团队列表</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-violet-50/70 dark:bg-violet-500/10">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide whitespace-nowrap">团队名称</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide whitespace-nowrap">成员/上限</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide whitespace-nowrap">状态</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide whitespace-nowrap min-w-[120px]">有效性</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide whitespace-nowrap">到期时间</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide whitespace-nowrap">优先级</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide whitespace-nowrap">邀请数</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800">
                {teams.map((team) => (
                  <tr key={team.id} className="hover:bg-violet-50/50 dark:hover:bg-violet-500/10 transition-colors">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-zinc-900 dark:text-white truncate" title={team.name}>{team.name}</div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono truncate" title={team.accountId}>{team.accountId.slice(0, 8)}...</div>
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
                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                          team.isActive
                            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
                            : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300"
                        }`}
                      >
                        {team.isActive ? "已启用" : "已禁用"}
                      </button>
                    </td>
                    <td className="px-6 py-4 min-w-[120px]">{renderTeamValidity(team)}</td>
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
                            {new Date(team.expiresAt).toLocaleString("zh-CN", {
                              timeZone: "Asia/Shanghai",
                              hour12: false,
                            })}
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
                      <div className="flex flex-nowrap items-center gap-2">
                        <button
                          onClick={() => openInviteModal(team)}
                          disabled={!team.isActive || isExpired(team.expiresAt)}
                          className="inline-flex items-center px-3 py-1.5 rounded-xl text-sm text-orange-700 hover:text-orange-900 hover:bg-white dark:text-orange-300 dark:hover:text-orange-200 dark:hover:bg-zinc-900/40 transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          邀请
                        </button>
                        <button
                          onClick={() => handleSyncTeam(team)}
                          disabled={Boolean(syncingTeamIds[team.id])}
                          className="inline-flex items-center px-3 py-1.5 rounded-xl text-sm text-emerald-700 hover:text-emerald-900 hover:bg-white dark:text-emerald-300 dark:hover:text-emerald-200 dark:hover:bg-zinc-900/40 transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          {syncingTeamIds[team.id] ? "同步中..." : "同步"}
                        </button>
                        <button
                          onClick={() => checkTeamValidity(team)}
                          disabled={teamValidityById[team.id]?.state === "loading"}
                          className="inline-flex items-center px-3 py-1.5 rounded-xl text-sm text-zinc-700 hover:text-zinc-900 hover:bg-white dark:text-zinc-300 dark:hover:text-white dark:hover:bg-zinc-900/40 transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          检测
                        </button>
                        <button
                          onClick={() => handleViewMembers(team)}
                          className="inline-flex items-center px-3 py-1.5 rounded-xl text-sm text-zinc-700 hover:text-zinc-900 hover:bg-white dark:text-zinc-300 dark:hover:text-white dark:hover:bg-zinc-900/40 transition-colors whitespace-nowrap"
                        >
                          查看成员
                        </button>
                        <button
                          onClick={() => handleStartEdit(team)}
                          className="inline-flex items-center px-3 py-1.5 rounded-xl text-sm text-violet-700 hover:text-violet-900 hover:bg-white dark:text-violet-300 dark:hover:text-violet-200 dark:hover:bg-zinc-900/40 transition-colors whitespace-nowrap"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDelete(team.id)}
                          className="inline-flex items-center px-3 py-1.5 rounded-xl text-sm text-red-700 hover:text-red-900 hover:bg-white dark:text-red-300 dark:hover:text-red-200 dark:hover:bg-zinc-900/40 transition-colors whitespace-nowrap"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {teams.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-10 text-center text-zinc-600 dark:text-zinc-400">
                      暂无团队，点击“添加团队”开始配置
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Help */}
        <div className="mt-8 rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-violet-50/70 dark:bg-violet-500/10 p-6">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">使用说明</h3>
          <ul className="text-sm text-zinc-700 dark:text-zinc-200 space-y-1 list-disc list-inside">
            <li>添加多个 ChatGPT Team 账户，系统会自动分配邀请到未满的团队</li>
            <li>优先级数字越小，优先使用该团队（0 为最高优先级）</li>
            <li>成员上限设为 0 表示无限制</li>
            <li>到期时间会在添加团队时自动从 ChatGPT 订阅信息获取，到期后团队将不再接收新邀请</li>
            <li>点击“邀请”可指定某个团队手动发送邀请邮件</li>
            <li>点击“检测”可实时检查团队凭据有效性（可能受到 Cloudflare/限流影响）</li>
            <li>列表支持单团队“同步”，必要时再用顶部“同步全部”</li>
            <li>禁用的团队不会接收新邀请</li>
          </ul>
        </div>
      </main>

      {/* Manual Invite Modal */}
      {inviteModalOpen && inviteModalTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={closeInviteModal}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-modal-title"
            aria-describedby="invite-modal-desc"
            className="relative w-full max-w-lg rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/90 dark:bg-zinc-900/60 backdrop-blur shadow-xl overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-zinc-200/70 dark:border-zinc-800 bg-violet-50/70 dark:bg-violet-500/10 flex items-center justify-between">
              <div>
                <h2 id="invite-modal-title" className="text-lg font-semibold text-zinc-900 dark:text-white">
                  手动邀请：{inviteModalTeam.name}
                </h2>
                <div id="invite-modal-desc" className="text-xs text-zinc-600 dark:text-zinc-300">
                  将使用该团队的凭据发送 Team 邀请
                </div>
              </div>
              <button
                onClick={closeInviteModal}
                className="inline-flex items-center px-3 py-2 rounded-xl border border-violet-200/70 dark:border-violet-500/25 bg-white/70 dark:bg-zinc-900/40 text-sm text-zinc-900 dark:text-white hover:bg-white dark:hover:bg-zinc-900/60 transition-colors"
              >
                关闭
              </button>
            </div>

            <div className="p-6">
              {(inviteModalTeam.maxMembers !== 0 &&
                inviteModalTeam.currentMembers >= inviteModalTeam.maxMembers) && (
                <div className="mb-4 bg-yellow-50/80 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4">
                  <div className="text-sm text-yellow-800 dark:text-yellow-200">
                    该团队当前已满员（{inviteModalTeam.currentMembers}/
                    {inviteModalTeam.maxMembers}）。如实际仍有空位，请先在列表中为该团队点击“同步”或调整上限。
                  </div>
                </div>
              )}

              <form onSubmit={submitManualInvite} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    邮箱
                  </label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-zinc-300/80 dark:border-zinc-700 bg-white/90 dark:bg-zinc-800/80 text-zinc-900 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
                    placeholder="name@example.com"
                    required
                    autoFocus
                  />
                </div>

                {inviteError && (
                  <div role="alert" className="bg-red-50/80 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3">
                    <div className="text-sm text-red-700 dark:text-red-300">
                      {inviteError}
                    </div>
                  </div>
                )}

                {inviteSuccess && (
                  <div role="status" className="bg-green-50/80 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-3">
                    <div className="text-sm text-green-700 dark:text-green-300">
                      {inviteSuccess}
                    </div>
                  </div>
                )}

                <div className="flex gap-4">
                  <button
                    type="submit"
                    disabled={inviteSubmitting}
                    className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-medium rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-zinc-900"
                  >
                    {inviteSubmitting ? "发送中..." : "发送邀请"}
                  </button>
                  <button
                    type="button"
                    onClick={closeInviteModal}
                    className="px-6 py-2.5 rounded-xl border border-violet-200/70 dark:border-violet-500/25 bg-white/70 dark:bg-zinc-900/40 text-zinc-900 dark:text-white hover:bg-white dark:hover:bg-zinc-900/60 font-medium transition-colors"
                  >
                    取消
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Members Modal */}
      {membersModalOpen && membersModalTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={closeMembersModal}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="members-modal-title"
            className="relative w-full max-w-5xl rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/90 dark:bg-zinc-900/60 backdrop-blur shadow-xl overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-zinc-200/70 dark:border-zinc-800 bg-violet-50/70 dark:bg-violet-500/10 flex items-center justify-between">
              <div>
                <h2 id="members-modal-title" className="text-lg font-semibold text-zinc-900 dark:text-white">
                  成员列表：{membersModalTeam.name}
                </h2>
                <div className="text-xs text-zinc-600 dark:text-zinc-300">
                  {membersTotal !== null ? `共 ${membersTotal} 人` : " "}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => fetchTeamMembers(membersModalTeam)}
                  disabled={membersLoading}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-violet-200/70 dark:border-violet-500/25 bg-white/70 dark:bg-zinc-900/40 text-sm text-zinc-900 dark:text-white hover:bg-white dark:hover:bg-zinc-900/60 transition-colors disabled:opacity-50"
                >
                  {membersLoading && (
                    <svg className="animate-spin h-4 w-4 text-violet-600" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  )}
                  {membersLoading ? "加载中..." : "刷新"}
                </button>
                <button
                  onClick={closeMembersModal}
                  className="inline-flex items-center px-3 py-2 rounded-xl border border-violet-200/70 dark:border-violet-500/25 bg-white/70 dark:bg-zinc-900/40 text-sm text-zinc-900 dark:text-white hover:bg-white dark:hover:bg-zinc-900/60 transition-colors"
                >
                  关闭
                </button>
              </div>
            </div>

            <div className="p-6">
              {membersLoading && (
                <div className="text-sm text-zinc-600 dark:text-zinc-300">
                  正在获取成员列表...
                </div>
              )}

              {!membersLoading && membersError && (
                <div role="alert" className="bg-red-50/80 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
                  <div className="text-sm text-red-700 dark:text-red-300">
                    {membersError}
                  </div>
                  <button
                    onClick={() => fetchTeamMembers(membersModalTeam)}
                    className="mt-3 px-4 py-2.5 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-zinc-900"
                  >
                    重试
                  </button>
                </div>
              )}

              {!membersLoading && !membersError && kickError && (
                <div
                  role="alert"
                  className="mb-4 bg-red-50/80 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4"
                >
                  <div className="text-sm text-red-700 dark:text-red-300">
                    {kickError}
                  </div>
                </div>
              )}

              {!membersLoading && !membersError && (
                <div className="rounded-xl border border-zinc-200/70 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40 overflow-hidden">
                  <div className="max-h-[65vh] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-violet-50/70 dark:bg-violet-500/10 sticky top-0">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">
                            姓名
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">
                            邮箱
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">
                            角色
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">
                            加入时间
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">
                            ID
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">
                            操作
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800">
                        {members.map((member) => {
                          const isOwner = member.role.toLowerCase().includes("owner");
                          const isKicking = kickSubmittingId === member.id;
                          return (
                            <tr
                              key={member.id}
                              className="hover:bg-violet-50/50 dark:hover:bg-violet-500/10 transition-colors"
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
                              <td className="px-4 py-3">
                                <button
                                  type="button"
                                  disabled={isOwner || isKicking}
                                  onClick={() => handleKickMember(member)}
                                  className="inline-flex items-center px-3 py-1.5 rounded-lg border border-red-200/70 dark:border-red-500/30 bg-red-50/80 dark:bg-red-500/10 text-xs text-red-700 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors disabled:opacity-60"
                                >
                                  {isOwner ? "不可移除" : isKicking ? "踢出中..." : "踢出"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                        {members.length === 0 && (
                          <tr>
                            <td
                              colSpan={6}
                              className="px-4 py-10 text-center text-zinc-600 dark:text-zinc-400"
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
