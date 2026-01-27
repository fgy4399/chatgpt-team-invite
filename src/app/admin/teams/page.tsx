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
  reservedInvites?: number;
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

interface TeamReservation {
  id: string;
  email: string;
  status: string;
  createdAt: string;
  processedAt?: string | null;
  inviteCode?: {
    code: string;
    status: string;
    createdAt: string;
    expiresAt?: string | null;
    usedAt?: string | null;
  };
}

interface UpstreamInvite {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  isScimManaged?: boolean;
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
      seatsEntitled?: number;
      willRenew?: boolean;
      activeUntil?: string;
      billingPeriod?: string;
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
    seats_entitled?: number;
    plan_type?: string;
    active_until?: string;
    billing_period?: string;
    will_renew?: boolean;
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
  const [membersTab, setMembersTab] = useState<
    "members" | "reservations" | "upstreamInvites"
  >("members");
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [membersTotal, setMembersTotal] = useState<number | null>(null);
  const [kickSubmittingId, setKickSubmittingId] = useState<string | null>(null);
  const [kickError, setKickError] = useState("");
  // 成员降级相关状态
  const [demoteSubmittingIds, setDemoteSubmittingIds] = useState<
    Record<string, boolean>
  >({});
  const [demoteAllLoading, setDemoteAllLoading] = useState(false);
  const [demoteError, setDemoteError] = useState("");
  const [demoteSuccess, setDemoteSuccess] = useState("");
  const membersFetchControllerRef = useRef<AbortController | null>(null);

  const [reservationsLoading, setReservationsLoading] = useState(false);
  const [reservationsError, setReservationsError] = useState("");
  const [reservations, setReservations] = useState<TeamReservation[]>([]);
  const [reservationSelection, setReservationSelection] = useState<
    Record<string, boolean>
  >({});
  const [reservationActionLoading, setReservationActionLoading] =
    useState(false);
  const [reservationActionError, setReservationActionError] = useState("");
  const [reservationActionSuccess, setReservationActionSuccess] = useState("");
  const reservationsFetchControllerRef = useRef<AbortController | null>(null);

  const [upstreamInvitesLoading, setUpstreamInvitesLoading] = useState(false);
  const [upstreamInvitesError, setUpstreamInvitesError] = useState("");
  const [upstreamInvites, setUpstreamInvites] = useState<UpstreamInvite[]>([]);
  const [upstreamInvitesTotal, setUpstreamInvitesTotal] = useState<number | null>(
    null
  );
  const [upstreamInviteSelection, setUpstreamInviteSelection] = useState<
    Record<string, boolean>
  >({});
  const [upstreamInviteActionLoading, setUpstreamInviteActionLoading] =
    useState(false);
  const [upstreamInviteActionError, setUpstreamInviteActionError] = useState("");
  const [upstreamInviteActionSuccess, setUpstreamInviteActionSuccess] =
    useState("");
  const upstreamInvitesFetchControllerRef = useRef<AbortController | null>(null);

  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteModalTeam, setInviteModalTeam] = useState<Team | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [syncingTeamIds, setSyncingTeamIds] = useState<Record<string, boolean>>(
    {}
  );
  const [cancelRenewLoadingById, setCancelRenewLoadingById] = useState<
    Record<string, boolean>
  >({});

  const [teamValidityById, setTeamValidityById] = useState<
    Record<string, TeamValidityState>
  >({});

  const getToken = () => localStorage.getItem("admin_token");
  const memberEmailSet = new Set(members.map((member) => member.email.toLowerCase()));
  const ownerCount = members.filter((member) =>
    member.role.toLowerCase().includes("owner")
  ).length;
  const notJoinedReservationCount = reservations.filter(
    (item) => !memberEmailSet.has(item.email.toLowerCase())
  ).length;

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
              seatsEntitled: sub.seats_entitled,
              willRenew: sub.will_renew,
              activeUntil: sub.active_until,
              billingPeriod: sub.billing_period,
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

  const handleCancelRenew = async (team: Team) => {
    const token = getToken();
    if (!token) {
      router.push("/admin");
      return;
    }

    if (!confirm(`确定取消 ${team.name} 的自动续费吗？`)) {
      return;
    }

    setCancelRenewLoadingById((prev) => ({ ...prev, [team.id]: true }));

    try {
      const res = await fetch(
        `/api/admin/teams/${team.id}/subscription/cancel`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (res.status === 401) {
        localStorage.removeItem("admin_token");
        router.push("/admin");
        return;
      }

      type CancelSubscriptionApiResponse = {
        success?: boolean;
        error?: string;
        subscription?: {
          plan_type?: string;
          active_until?: string;
          billing_period?: string;
          will_renew?: boolean;
          seats_available?: number;
          seats_used?: number;
        };
      };

      const data = (await res
        .json()
        .catch(() => ({}))) as Partial<CancelSubscriptionApiResponse>;

      if (!res.ok || !data.success) {
        alert(data.error || "取消自动续费失败");
        return;
      }

      if (data.subscription) {
        setTeamValidityById((prev) => {
          const current = prev[team.id];
          if (!current || current.state !== "ok") {
            return prev;
          }
          return {
            ...prev,
            [team.id]: {
              ...current,
              planType: data.subscription?.plan_type ?? current.planType,
              activeUntil: data.subscription?.active_until ?? current.activeUntil,
              billingPeriod:
                data.subscription?.billing_period ?? current.billingPeriod,
              willRenew:
                typeof data.subscription?.will_renew === "boolean"
                  ? data.subscription?.will_renew
                  : current.willRenew,
              seatsAvailable:
                typeof data.subscription?.seats_available === "number"
                  ? data.subscription?.seats_available
                  : current.seatsAvailable,
              seatsUsed:
                typeof data.subscription?.seats_used === "number"
                  ? data.subscription?.seats_used
                  : current.seatsUsed,
            },
          };
        });
      } else {
        await checkTeamValidity(team);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "取消自动续费失败");
    } finally {
      setCancelRenewLoadingById((prev) => ({ ...prev, [team.id]: false }));
    }
  };

  const closeMembersModal = useCallback(() => {
    membersFetchControllerRef.current?.abort();
    membersFetchControllerRef.current = null;
    reservationsFetchControllerRef.current?.abort();
    reservationsFetchControllerRef.current = null;
    upstreamInvitesFetchControllerRef.current?.abort();
    upstreamInvitesFetchControllerRef.current = null;
    setMembersModalOpen(false);
    setMembersModalTeam(null);
    setMembersTab("members");
    setMembersLoading(false);
    setMembersError("");
    setMembers([]);
    setMembersTotal(null);
    setKickSubmittingId(null);
    setKickError("");
    setDemoteSubmittingIds({});
    setDemoteAllLoading(false);
    setDemoteError("");
    setDemoteSuccess("");
    setReservationsLoading(false);
    setReservationsError("");
    setReservations([]);
    setReservationSelection({});
    setReservationActionLoading(false);
    setReservationActionError("");
    setReservationActionSuccess("");
    setUpstreamInvitesLoading(false);
    setUpstreamInvitesError("");
    setUpstreamInvites([]);
    setUpstreamInvitesTotal(null);
    setUpstreamInviteSelection({});
    setUpstreamInviteActionLoading(false);
    setUpstreamInviteActionError("");
    setUpstreamInviteActionSuccess("");
  }, []);

  const fetchTeamReservations = useCallback(
    async (team: Team) => {
      const token = getToken();
      if (!token) {
        router.push("/admin");
        return;
      }

      reservationsFetchControllerRef.current?.abort();
      const controller = new AbortController();
      reservationsFetchControllerRef.current = controller;

      setReservationsLoading(true);
      setReservationsError("");
      setReservationActionError("");
      setReservationActionSuccess("");
      setReservationSelection({});
      setReservations([]);

      try {
        const res = await fetch(`/api/admin/teams/${team.id}/reservations`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        if (res.status === 401) {
          localStorage.removeItem("admin_token");
          router.push("/admin");
          return;
        }

        type TeamReservationsApiResponse = {
          reservations?: TeamReservation[];
          error?: string;
        };

        const data = (await res
          .json()
          .catch(() => ({}))) as Partial<TeamReservationsApiResponse>;

        if (reservationsFetchControllerRef.current !== controller) {
          return;
        }

        if (res.ok) {
          setReservations(
            Array.isArray(data.reservations)
              ? (data.reservations as TeamReservation[])
              : []
          );
        } else {
          setReservationsError(data.error || "获取占位列表失败");
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setReservationsError("获取占位列表失败，请稍后重试");
      } finally {
        if (reservationsFetchControllerRef.current === controller) {
          setReservationsLoading(false);
        }
      }
    },
    [router]
  );

  const fetchUpstreamInvites = useCallback(
    async (team: Team) => {
      const token = getToken();
      if (!token) {
        router.push("/admin");
        return;
      }

      upstreamInvitesFetchControllerRef.current?.abort();
      const controller = new AbortController();
      upstreamInvitesFetchControllerRef.current = controller;

      setUpstreamInvitesLoading(true);
      setUpstreamInvitesError("");
      setUpstreamInviteActionError("");
      setUpstreamInviteActionSuccess("");
      setUpstreamInviteSelection({});
      setUpstreamInvites([]);
      setUpstreamInvitesTotal(null);

      try {
        const res = await fetch(
          `/api/admin/teams/${team.id}/upstream-invites?offset=0&limit=100&query=`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          }
        );

        if (res.status === 401) {
          localStorage.removeItem("admin_token");
          router.push("/admin");
          return;
        }

        type UpstreamInvitesApiResponse = {
          invites?: UpstreamInvite[];
          total?: number;
          error?: string;
        };

        const data = (await res
          .json()
          .catch(() => ({}))) as Partial<UpstreamInvitesApiResponse>;

        if (upstreamInvitesFetchControllerRef.current !== controller) {
          return;
        }

        if (res.ok) {
          const list = Array.isArray(data.invites)
            ? (data.invites as UpstreamInvite[])
            : [];
          setUpstreamInvites(list);
          setUpstreamInvitesTotal(
            typeof data.total === "number" ? data.total : list.length
          );
        } else {
          setUpstreamInvitesError(data.error || "获取上游邀请失败");
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setUpstreamInvitesError("获取上游邀请失败，请稍后重试");
      } finally {
        if (upstreamInvitesFetchControllerRef.current === controller) {
          setUpstreamInvitesLoading(false);
        }
      }
    },
    [router]
  );

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
    setDemoteError("");
    setDemoteSuccess("");
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
    setMembersTab("members");
    setKickError("");
    await Promise.all([
      fetchTeamMembers(team),
      fetchTeamReservations(team),
      fetchUpstreamInvites(team),
    ]);
  };

  const releaseSelectedReservations = async () => {
    const team = membersModalTeam;
    if (!team) return;

    const token = getToken();
    if (!token) {
      router.push("/admin");
      return;
    }

    const invitationIds = Object.keys(reservationSelection).filter(
      (id) => reservationSelection[id]
    );

    if (invitationIds.length === 0) {
      setReservationActionError("请先选择要释放的占位记录");
      return;
    }

    if (
      !confirm(
        `确定要释放选中的 ${invitationIds.length} 个占位吗？这不会取消上游邀请，但会让系统释放本地占位。`
      )
    ) {
      return;
    }

    setReservationActionLoading(true);
    setReservationActionError("");
    setReservationActionSuccess("");

    try {
      const actualMemberCount =
        typeof membersTotal === "number" ? membersTotal : undefined;

      const res = await fetch(`/api/admin/teams/${team.id}/reservations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "release",
          invitationIds,
          actualMemberCount,
        }),
      });

      if (res.status === 401) {
        localStorage.removeItem("admin_token");
        router.push("/admin");
        return;
      }

      type ReleaseApiResponse = {
        success?: boolean;
        releasedCount?: number;
        currentMembers?: number;
        warning?: string;
        error?: string;
      };

      const data = (await res
        .json()
        .catch(() => ({}))) as Partial<ReleaseApiResponse>;

      if (!res.ok || !data.success) {
        setReservationActionError(data.error || "释放占位失败");
        return;
      }

      const released = typeof data.releasedCount === "number" ? data.releasedCount : 0;
      const warning = typeof data.warning === "string" && data.warning ? `（${data.warning}）` : "";
      setReservationActionSuccess(`已释放 ${released} 个占位${warning}`);

      if (typeof data.currentMembers === "number") {
        const nextCurrentMembers = data.currentMembers;
        setMembersModalTeam((prev) =>
          prev && prev.id === team.id ? { ...prev, currentMembers: nextCurrentMembers } : prev
        );
        setTeams((prev) =>
          prev.map((item) =>
            item.id === team.id ? { ...item, currentMembers: nextCurrentMembers } : item
          )
        );
      }

      await fetchTeamReservations(team);
      await fetchTeams();
    } catch (error) {
      setReservationActionError(
        error instanceof Error ? error.message : "释放占位失败，请稍后重试"
      );
    } finally {
      setReservationActionLoading(false);
    }
  };

  const recalculateTeamOccupancy = async () => {
    const team = membersModalTeam;
    if (!team) return;

    const token = getToken();
    if (!token) {
      router.push("/admin");
      return;
    }

    setReservationActionLoading(true);
    setReservationActionError("");
    setReservationActionSuccess("");

    try {
      const actualMemberCount =
        typeof membersTotal === "number" ? membersTotal : undefined;

      const res = await fetch(`/api/admin/teams/${team.id}/reservations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "recalculate",
          actualMemberCount,
        }),
      });

      if (res.status === 401) {
        localStorage.removeItem("admin_token");
        router.push("/admin");
        return;
      }

      type RecalculateApiResponse = {
        success?: boolean;
        currentMembers?: number;
        warning?: string;
        error?: string;
      };

      const data = (await res
        .json()
        .catch(() => ({}))) as Partial<RecalculateApiResponse>;

      if (!res.ok || !data.success) {
        setReservationActionError(data.error || "重新计算失败");
        return;
      }

      const warning = typeof data.warning === "string" && data.warning ? `（${data.warning}）` : "";
      setReservationActionSuccess(`已重新计算占用数${warning}`);

      if (typeof data.currentMembers === "number") {
        const nextCurrentMembers = data.currentMembers;
        setMembersModalTeam((prev) =>
          prev && prev.id === team.id ? { ...prev, currentMembers: nextCurrentMembers } : prev
        );
        setTeams((prev) =>
          prev.map((item) =>
            item.id === team.id ? { ...item, currentMembers: nextCurrentMembers } : item
          )
        );
      }

      await fetchTeamReservations(team);
      await fetchTeams();
    } catch (error) {
      setReservationActionError(
        error instanceof Error ? error.message : "重新计算失败，请稍后重试"
      );
    } finally {
      setReservationActionLoading(false);
    }
  };

  const selectUnmatchedReservations = () => {
    const next: Record<string, boolean> = {};
    for (const item of reservations) {
      if (!memberEmailSet.has(item.email.toLowerCase())) {
        next[item.id] = true;
      }
    }
    setReservationSelection(next);
  };

  const selectAllUpstreamInvites = () => {
    const next: Record<string, boolean> = {};
    for (const item of upstreamInvites) {
      next[item.id] = true;
    }
    setUpstreamInviteSelection(next);
  };

  const cancelSelectedUpstreamInvites = async () => {
    const team = membersModalTeam;
    if (!team) return;

    const token = getToken();
    if (!token) {
      router.push("/admin");
      return;
    }

    const inviteIds = Object.keys(upstreamInviteSelection).filter(
      (id) => upstreamInviteSelection[id]
    );

    if (inviteIds.length === 0) {
      setUpstreamInviteActionError("请先选择要取消的上游邀请");
      return;
    }

    const inviteEmails = upstreamInvites
      .filter((item) => inviteIds.includes(item.id))
      .map((item) => item.email)
      .filter(Boolean);

    if (inviteEmails.length !== inviteIds.length) {
      setUpstreamInviteActionError(
        "上游邀请列表已变化，请先点击“刷新”后再试"
      );
      return;
    }

    if (
      !confirm(
        `确定要取消选中的 ${inviteEmails.length} 个上游邀请吗？这会在 ChatGPT 官网侧删除 pending invite，用于释放占用的 seats。`
      )
    ) {
      return;
    }

    setUpstreamInviteActionLoading(true);
    setUpstreamInviteActionError("");
    setUpstreamInviteActionSuccess("");

    try {
      const res = await fetch(`/api/admin/teams/${team.id}/upstream-invites`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "cancel", inviteEmails }),
      });

      if (res.status === 401) {
        localStorage.removeItem("admin_token");
        router.push("/admin");
        return;
      }

      type CancelUpstreamInvitesResponse = {
        success?: boolean;
        cancelledCount?: number;
        error?: string;
      };

      const data = (await res
        .json()
        .catch(() => ({}))) as Partial<CancelUpstreamInvitesResponse>;

      if (!res.ok || !data.success) {
        setUpstreamInviteActionError(data.error || "取消上游邀请失败");
        return;
      }

      const cancelled =
        typeof data.cancelledCount === "number" ? data.cancelledCount : 0;
      setUpstreamInviteActionSuccess(`已请求取消 ${cancelled} 个上游邀请`);

      await fetchUpstreamInvites(team);
    } catch (error) {
      setUpstreamInviteActionError(
        error instanceof Error ? error.message : "取消上游邀请失败，请稍后重试"
      );
    } finally {
      setUpstreamInviteActionLoading(false);
    }
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

  // 批量或单个降级成员角色
  const handleDemoteMembers = async (
    memberIds: string[],
    role: "account-admin" | "standard-user",
    options?: { batch?: boolean }
  ) => {
    const team = membersModalTeam;
    if (!team) return;

    if (memberIds.length === 0) {
      setDemoteError("没有可降级的成员");
      return;
    }

    const token = getToken();
    if (!token) {
      router.push("/admin");
      return;
    }

    setDemoteError("");
    setDemoteSuccess("");

    if (options?.batch) {
      setDemoteAllLoading(true);
    } else {
      setDemoteSubmittingIds((prev) => {
        const next = { ...prev };
        memberIds.forEach((id) => {
          next[id] = true;
        });
        return next;
      });
    }

    try {
      const res = await fetch(`/api/admin/teams/${team.id}/members/demote`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ memberIds, role }),
      });

      if (res.status === 401) {
        localStorage.removeItem("admin_token");
        router.push("/admin");
        return;
      }

      type DemoteMembersApiResponse = {
        success?: boolean;
        role?: string;
        updatedIds?: string[];
        updatedCount?: number;
        failed?: Array<{ memberId: string; error?: string }>;
        error?: string;
      };

      const data = (await res
        .json()
        .catch(() => ({}))) as Partial<DemoteMembersApiResponse>;

      if (!res.ok || !data.updatedIds) {
        setDemoteError(data.error || "降级成员失败");
        return;
      }

      const updatedIds = Array.isArray(data.updatedIds) ? data.updatedIds : [];
      const failed = Array.isArray(data.failed) ? data.failed : [];

      if (updatedIds.length > 0) {
        setMembers((prev) =>
          prev.map((item) =>
            updatedIds.includes(item.id) ? { ...item, role } : item
          )
        );
      }

      const successCount =
        typeof data.updatedCount === "number" ? data.updatedCount : updatedIds.length;
      if (successCount > 0) {
        setDemoteSuccess(`已降级 ${successCount} 名成员`);
      }

      if (failed.length > 0) {
        const firstError = failed[0]?.error || "部分成员降级失败";
        setDemoteError(firstError);
      }
    } catch (error) {
      setDemoteError(error instanceof Error ? error.message : "降级成员失败");
    } finally {
      if (options?.batch) {
        setDemoteAllLoading(false);
      } else {
        setDemoteSubmittingIds((prev) => {
          const next = { ...prev };
          memberIds.forEach((id) => {
            delete next[id];
          });
          return next;
        });
      }
    }
  };

  const handleDemoteMember = async (
    member: TeamMember,
    role: "account-admin" | "standard-user"
  ) => {
    if (!confirm(`确定将 ${member.email} 降级为 ${role === "account-admin" ? "管理员" : "成员"} 吗？`)) {
      return;
    }
    await handleDemoteMembers([member.id], role);
  };

  // 一键降级当前团队内所有 Owner
  const handleDemoteOwners = async (role: "account-admin" | "standard-user") => {
    const ownerIds = members
      .filter((member) => member.role.toLowerCase().includes("owner"))
      .map((member) => member.id);

    if (ownerIds.length === 0) {
      setDemoteError("当前没有可降级的 Owner");
      return;
    }

    if (
      !confirm(
        `确定将 ${ownerIds.length} 名 Owner 全部降级为 ${
          role === "account-admin" ? "管理员" : "成员"
        } 吗？`
      )
    ) {
      return;
    }

    await handleDemoteMembers(ownerIds, role, { batch: true });
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
      const hasRenewInfo = typeof state.willRenew === "boolean";
      const activeUntil = state.activeUntil;
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
          {hasRenewInfo && (
            <span
              className={`text-xs ${
                state.willRenew
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-amber-700 dark:text-amber-300"
              }`}
            >
              {state.willRenew ? "自动续费" : "已取消续费"}
            </span>
          )}
          {activeUntil && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              到期 {new Date(activeUntil).toLocaleString("zh-CN", {
                timeZone: "Asia/Shanghai",
                hour12: false,
              })}
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
                    Cookies *
                  </label>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                    必须包含 __Secure-next-auth.session-token，用于自动刷新 Access Token
                  </p>
                  <input
                    type="text"
                    value={newTeam.cookies}
                    onChange={(e) => setNewTeam({ ...newTeam, cookies: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-zinc-300/80 dark:border-zinc-700 bg-white/90 dark:bg-zinc-800/80 text-zinc-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
                    placeholder="请粘贴完整 Cookies"
                    required
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
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                    建议更新以保证自动刷新可用，必须包含 __Secure-next-auth.session-token
                  </p>
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
            <table className="w-full table-auto">
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
              <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800 whitespace-nowrap">
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
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                        占位 {team.reservedInvites ?? 0}
                      </div>
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
                          onClick={() => handleCancelRenew(team)}
                          disabled={
                            Boolean(cancelRenewLoadingById[team.id]) ||
                            teamValidityById[team.id]?.state !== "ok" ||
                            teamValidityById[team.id]?.willRenew !== true
                          }
                          className="inline-flex items-center px-3 py-1.5 rounded-xl text-sm text-amber-700 hover:text-amber-900 hover:bg-white dark:text-amber-300 dark:hover:text-amber-200 dark:hover:bg-zinc-900/40 transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          {cancelRenewLoadingById[team.id]
                            ? "取消中..."
                            : teamValidityById[team.id]?.state === "ok" &&
                                teamValidityById[team.id]?.willRenew === false
                              ? "已取消续费"
                              : "取消续费"}
                        </button>
                        <button
                          onClick={() => handleViewMembers(team)}
                          className="inline-flex items-center px-3 py-1.5 rounded-xl text-sm text-zinc-700 hover:text-zinc-900 hover:bg-white dark:text-zinc-300 dark:hover:text-white dark:hover:bg-zinc-900/40 transition-colors whitespace-nowrap"
                        >
                          对账
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
            <li>点击“对账”可对比真实成员与占位邀请，并按需释放占位</li>
            <li>点击“检测”可实时检查团队凭据有效性（可能受到 Cloudflare/限流影响）</li>
            <li>检测后可显示订阅到期与续费状态，支持取消自动续费（到期前仍可使用）</li>
            <li>列表支持单个团队“同步”，必要时再用顶部“同步全部”</li>
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
                  对账：{membersModalTeam.name}
                </h2>
                <div className="text-xs text-zinc-600 dark:text-zinc-300">
                  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>
                      当前占用{" "}
                      {membersModalTeam.currentMembers} /{" "}
                      {membersModalTeam.maxMembers === 0
                        ? "∞"
                        : membersModalTeam.maxMembers}
                    </span>
                    <span className="text-zinc-400">·</span>
                    <span>真实成员 {membersTotal ?? "-"}</span>
                    <span className="text-zinc-400">·</span>
                    <span>占位 {reservations.length}</span>
                    <span className="text-zinc-400">·</span>
                    <span>未加入 {notJoinedReservationCount}</span>
                    <span className="text-zinc-400">·</span>
                    <span>上游邀请 {upstreamInvitesTotal ?? "-"}</span>
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="inline-flex rounded-xl border border-violet-200/70 dark:border-violet-500/25 bg-white/70 dark:bg-zinc-900/40 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setMembersTab("members")}
                    className={`px-3 py-2 text-sm transition-colors ${
                      membersTab === "members"
                        ? "bg-violet-600 text-white"
                        : "text-zinc-700 hover:text-zinc-900 hover:bg-white dark:text-zinc-300 dark:hover:text-white dark:hover:bg-zinc-900/60"
                    }`}
                  >
                    成员
                  </button>
                  <button
                    type="button"
                    onClick={() => setMembersTab("reservations")}
                    className={`px-3 py-2 text-sm transition-colors ${
                      membersTab === "reservations"
                        ? "bg-violet-600 text-white"
                        : "text-zinc-700 hover:text-zinc-900 hover:bg-white dark:text-zinc-300 dark:hover:text-white dark:hover:bg-zinc-900/60"
                    }`}
                  >
                    占位
                  </button>
                  <button
                    type="button"
                    onClick={() => setMembersTab("upstreamInvites")}
                    className={`px-3 py-2 text-sm transition-colors ${
                      membersTab === "upstreamInvites"
                        ? "bg-violet-600 text-white"
                        : "text-zinc-700 hover:text-zinc-900 hover:bg-white dark:text-zinc-300 dark:hover:text-white dark:hover:bg-zinc-900/60"
                    }`}
                  >
                    上游邀请
                  </button>
                </div>
                <button
                  onClick={() =>
                    Promise.all([
                      fetchTeamMembers(membersModalTeam),
                      fetchTeamReservations(membersModalTeam),
                      fetchUpstreamInvites(membersModalTeam),
                    ])
                  }
                  disabled={
                    membersLoading || reservationsLoading || upstreamInvitesLoading
                  }
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-violet-200/70 dark:border-violet-500/25 bg-white/70 dark:bg-zinc-900/40 text-sm text-zinc-900 dark:text-white hover:bg-white dark:hover:bg-zinc-900/60 transition-colors disabled:opacity-50"
                >
                  {(membersLoading || reservationsLoading || upstreamInvitesLoading) && (
                    <svg className="animate-spin h-4 w-4 text-violet-600" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  )}
                  {membersLoading || reservationsLoading || upstreamInvitesLoading
                    ? "加载中..."
                    : "刷新"}
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
              {membersTab === "reservations" && (
                <div className="mb-5 rounded-xl border border-zinc-200/70 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40 p-4">
                  <div className="text-sm font-medium text-zinc-900 dark:text-white mb-1">
                    占位说明
                  </div>
                  <div className="text-sm text-zinc-600 dark:text-zinc-300">
                    占位来自邀请码兑换产生的邀请记录（状态为 PENDING/SUCCESS）。SUCCESS 仅表示邀请邮件发送成功，是否已加入请对照成员列表。释放占位不会撤销上游邀请，只影响本系统的名额判断。
                  </div>
                </div>
              )}

              {membersTab === "upstreamInvites" && (
                <div className="mb-5 rounded-xl border border-zinc-200/70 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40 p-4">
                  <div className="text-sm font-medium text-zinc-900 dark:text-white mb-1">
                    上游邀请说明
                  </div>
                  <div className="text-sm text-zinc-600 dark:text-zinc-300">
                    这里展示的是 ChatGPT 官网侧的 Pending invites。它们会占用上游 seats（尤其是 free trial），导致即使成员没满也无法再邀请。取消上游邀请会在 ChatGPT 官网侧删除 pending invite，用于释放 seats，但不会影响本系统的本地占位记录。
                  </div>
                </div>
              )}

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

              {!membersLoading && !membersError && membersTab === "members" && kickError && (
                <div
                  role="alert"
                  className="mb-4 bg-red-50/80 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4"
                >
                  <div className="text-sm text-red-700 dark:text-red-300">
                    {kickError}
                  </div>
                </div>
              )}

              {!membersLoading && !membersError && membersTab === "members" && demoteError && (
                <div
                  role="alert"
                  className="mb-4 bg-red-50/80 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4"
                >
                  <div className="text-sm text-red-700 dark:text-red-300">
                    {demoteError}
                  </div>
                </div>
              )}

              {!membersLoading && !membersError && membersTab === "members" && demoteSuccess && (
                <div className="mb-4 bg-emerald-50/80 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4">
                  <div className="text-sm text-emerald-700 dark:text-emerald-200">
                    {demoteSuccess}
                  </div>
                </div>
              )}

              {!membersLoading && !membersError && membersTab === "members" && (
                <div className="rounded-xl border border-zinc-200/70 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-zinc-200/70 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/50">
                    <div className="text-sm text-zinc-600 dark:text-zinc-300">
                      当前 Owner 数量：{ownerCount}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDemoteOwners("account-admin")}
                        disabled={demoteAllLoading || ownerCount === 0}
                        className="inline-flex items-center px-3 py-1.5 rounded-lg border border-violet-200/70 dark:border-violet-500/30 bg-violet-50/80 dark:bg-violet-500/10 text-xs text-violet-700 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-500/20 transition-colors disabled:opacity-60"
                      >
                        {demoteAllLoading ? "批量降级中..." : "一键降级为管理员"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDemoteOwners("standard-user")}
                        disabled={demoteAllLoading || ownerCount === 0}
                        className="inline-flex items-center px-3 py-1.5 rounded-lg border border-amber-200/70 dark:border-amber-500/30 bg-amber-50/80 dark:bg-amber-500/10 text-xs text-amber-700 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors disabled:opacity-60"
                      >
                        {demoteAllLoading ? "批量降级中..." : "一键降级为成员"}
                      </button>
                    </div>
                  </div>
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
                          const isDemoting = Boolean(demoteSubmittingIds[member.id]);
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
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    disabled={!isOwner || isDemoting || demoteAllLoading}
                                    onClick={() => handleDemoteMember(member, "account-admin")}
                                    className="inline-flex items-center px-3 py-1.5 rounded-lg border border-violet-200/70 dark:border-violet-500/30 bg-violet-50/80 dark:bg-violet-500/10 text-xs text-violet-700 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-500/20 transition-colors disabled:opacity-60"
                                  >
                                    {isDemoting ? "降级中..." : "降级为管理员"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!isOwner || isDemoting || demoteAllLoading}
                                    onClick={() => handleDemoteMember(member, "standard-user")}
                                    className="inline-flex items-center px-3 py-1.5 rounded-lg border border-amber-200/70 dark:border-amber-500/30 bg-amber-50/80 dark:bg-amber-500/10 text-xs text-amber-700 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors disabled:opacity-60"
                                  >
                                    {isDemoting ? "降级中..." : "降级为成员"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isOwner || isKicking || isDemoting || demoteAllLoading}
                                    onClick={() => handleKickMember(member)}
                                    className="inline-flex items-center px-3 py-1.5 rounded-lg border border-red-200/70 dark:border-red-500/30 bg-red-50/80 dark:bg-red-500/10 text-xs text-red-700 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors disabled:opacity-60"
                                  >
                                    {isOwner ? "不可移除" : isKicking ? "踢出中..." : "踢出"}
                                  </button>
                                </div>
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

              {membersTab === "reservations" && (
                <div>
                  {reservationsLoading && (
                    <div className="text-sm text-zinc-600 dark:text-zinc-300">
                      正在获取占位列表...
                    </div>
                  )}

                  {!reservationsLoading && reservationsError && (
                    <div role="alert" className="bg-red-50/80 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
                      <div className="text-sm text-red-700 dark:text-red-300">
                        {reservationsError}
                      </div>
                      <button
                        onClick={() => fetchTeamReservations(membersModalTeam)}
                        className="mt-3 px-4 py-2.5 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-zinc-900"
                      >
                        重试
                      </button>
                    </div>
                  )}

                  {!reservationsLoading && !reservationsError && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm text-zinc-600 dark:text-zinc-300">
                          共 {reservations.length} 条占位记录
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={selectUnmatchedReservations}
                            className="px-4 py-2 rounded-xl border border-violet-200/70 dark:border-violet-500/25 bg-white/70 dark:bg-zinc-900/40 text-sm text-zinc-900 dark:text-white hover:bg-white dark:hover:bg-zinc-900/60 transition-colors"
                          >
                            选择未加入
                          </button>
                          <button
                            type="button"
                            onClick={recalculateTeamOccupancy}
                            disabled={reservationActionLoading}
                            className="px-4 py-2 rounded-xl border border-violet-200/70 dark:border-violet-500/25 bg-white/70 dark:bg-zinc-900/40 text-sm text-zinc-900 dark:text-white hover:bg-white dark:hover:bg-zinc-900/60 transition-colors disabled:opacity-50"
                          >
                            重新计算占用数
                          </button>
                          <button
                            type="button"
                            onClick={releaseSelectedReservations}
                            disabled={reservationActionLoading}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60"
                          >
                            {reservationActionLoading ? "处理中..." : "释放选中占位"}
                          </button>
                        </div>
                      </div>

                      {reservationActionError && (
                        <div role="alert" className="bg-red-50/80 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3">
                          <div className="text-sm text-red-700 dark:text-red-300">
                            {reservationActionError}
                          </div>
                        </div>
                      )}

                      {reservationActionSuccess && (
                        <div role="status" className="bg-green-50/80 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-3">
                          <div className="text-sm text-green-700 dark:text-green-300">
                            {reservationActionSuccess}
                          </div>
                        </div>
                      )}

                      <div className="rounded-xl border border-zinc-200/70 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40 overflow-hidden">
                        <div className="max-h-[65vh] overflow-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-violet-50/70 dark:bg-violet-500/10 sticky top-0">
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">
                                  选择
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">
                                  邮箱
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">
                                  邀请状态
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">
                                  邀请码
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">
                                  创建时间
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800">
                              {reservations.map((item) => {
                                const joined = memberEmailSet.has(
                                  item.email.toLowerCase()
                                );
                                const checked = Boolean(reservationSelection[item.id]);
                                const statusColor =
                                  item.status === "SUCCESS"
                                    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
                                    : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
                                const statusLabel =
                                  item.status === "SUCCESS" ? "已发送" : "处理中";
                                return (
                                  <tr
                                    key={item.id}
                                    className="hover:bg-violet-50/50 dark:hover:bg-violet-500/10 transition-colors"
                                  >
                                    <td className="px-4 py-3">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) =>
                                          setReservationSelection((prev) => ({
                                            ...prev,
                                            [item.id]: e.target.checked,
                                          }))
                                        }
                                      />
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex flex-col gap-1">
                                        <span className="text-zinc-900 dark:text-white font-mono text-xs">
                                          {item.email}
                                        </span>
                                        <span
                                          className={`text-xs ${
                                            joined
                                              ? "text-green-600 dark:text-green-300"
                                              : "text-zinc-500 dark:text-zinc-400"
                                          }`}
                                        >
                                          {joined ? "已加入" : "未加入"}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <span
                                        className={`px-2 py-1 rounded text-xs font-medium ${statusColor}`}
                                      >
                                        {statusLabel}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300 font-mono text-xs">
                                      {item.inviteCode?.code || "-"}
                                    </td>
                                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                                      {item.createdAt
                                        ? new Date(item.createdAt).toLocaleString()
                                        : "-"}
                                    </td>
                                  </tr>
                                );
                              })}
                              {reservations.length === 0 && (
                                <tr>
                                  <td
                                    colSpan={5}
                                    className="px-4 py-10 text-center text-zinc-600 dark:text-zinc-400"
                                  >
                                    暂无占位记录
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {membersTab === "upstreamInvites" && (
                <div>
                  {upstreamInvitesLoading && (
                    <div className="text-sm text-zinc-600 dark:text-zinc-300">
                      正在获取上游邀请...
                    </div>
                  )}

                  {!upstreamInvitesLoading && upstreamInvitesError && (
                    <div role="alert" className="bg-red-50/80 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
                      <div className="text-sm text-red-700 dark:text-red-300">
                        {upstreamInvitesError}
                      </div>
                      <button
                        onClick={() => fetchUpstreamInvites(membersModalTeam)}
                        className="mt-3 px-4 py-2.5 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-zinc-900"
                      >
                        重试
                      </button>
                    </div>
                  )}

                  {!upstreamInvitesLoading && !upstreamInvitesError && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm text-zinc-600 dark:text-zinc-300">
                          共 {upstreamInvitesTotal ?? upstreamInvites.length} 条上游邀请
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={selectAllUpstreamInvites}
                            className="px-4 py-2 rounded-xl border border-violet-200/70 dark:border-violet-500/25 bg-white/70 dark:bg-zinc-900/40 text-sm text-zinc-900 dark:text-white hover:bg-white dark:hover:bg-zinc-900/60 transition-colors"
                          >
                            全选
                          </button>
                          <button
                            type="button"
                            onClick={cancelSelectedUpstreamInvites}
                            disabled={upstreamInviteActionLoading}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60"
                          >
                            {upstreamInviteActionLoading
                              ? "处理中..."
                              : "取消选中上游邀请"}
                          </button>
                        </div>
                      </div>

                      {upstreamInviteActionError && (
                        <div role="alert" className="bg-red-50/80 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3">
                          <div className="text-sm text-red-700 dark:text-red-300">
                            {upstreamInviteActionError}
                          </div>
                        </div>
                      )}

                      {upstreamInviteActionSuccess && (
                        <div role="status" className="bg-green-50/80 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-3">
                          <div className="text-sm text-green-700 dark:text-green-300">
                            {upstreamInviteActionSuccess}
                          </div>
                        </div>
                      )}

                      <div className="rounded-xl border border-zinc-200/70 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40 overflow-hidden">
                        <div className="max-h-[65vh] overflow-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-violet-50/70 dark:bg-violet-500/10 sticky top-0">
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">
                                  选择
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">
                                  邮箱
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">
                                  角色
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">
                                  创建时间
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">
                                  ID
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800">
                              {upstreamInvites.map((item) => {
                                const checked = Boolean(
                                  upstreamInviteSelection[item.id]
                                );
                                return (
                                  <tr
                                    key={item.id}
                                    className="hover:bg-violet-50/50 dark:hover:bg-violet-500/10 transition-colors"
                                  >
                                    <td className="px-4 py-3">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) =>
                                          setUpstreamInviteSelection((prev) => ({
                                            ...prev,
                                            [item.id]: e.target.checked,
                                          }))
                                        }
                                      />
                                    </td>
                                    <td className="px-4 py-3 text-zinc-900 dark:text-white font-mono text-xs">
                                      {item.email}
                                    </td>
                                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                                      {item.role || "-"}
                                    </td>
                                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                                      {item.createdAt
                                        ? new Date(item.createdAt).toLocaleString()
                                        : "-"}
                                    </td>
                                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400 font-mono text-xs">
                                      {item.id}
                                    </td>
                                  </tr>
                                );
                              })}
                              {upstreamInvites.length === 0 && (
                                <tr>
                                  <td
                                    colSpan={5}
                                    className="px-4 py-10 text-center text-zinc-600 dark:text-zinc-400"
                                  >
                                    暂无上游邀请
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
