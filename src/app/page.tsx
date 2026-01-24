"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [adminHref, setAdminHref] = useState("/admin");
  const [hasAdminToken, setHasAdminToken] = useState(false);

  const handleAdminClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }
    if (hasAdminToken) {
      setIsRedirecting(true);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (token) {
      setHasAdminToken(true);
      setAdminHref("/admin/dashboard");
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Submit invitation
      const submitRes = await fetch("/api/invite/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, email }),
      });

      const submitData = await submitRes.json();

      if (submitData.success) {
        setSuccess(true);
        if (submitData.invitationId) {
          router.push(`/status/${submitData.invitationId}`);
        }
      } else {
        setError(submitData.message || "发送邀请失败");
      }
    } catch {
      setError("发生错误，请重试");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-linear-to-br from-violet-50 via-white to-violet-100 dark:from-zinc-950 dark:via-zinc-950 dark:to-violet-950/40 p-4 flex items-center justify-center">
        <div className="w-full max-w-md rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow-xl p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-7 h-7 text-green-700 dark:text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold text-zinc-900 dark:text-white mb-2">
            邀请已提交
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            请检查您的邮箱，查收 ChatGPT Team 邀请邮件。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-linear-to-br from-violet-50 via-white to-violet-100 dark:from-zinc-950 dark:via-zinc-950 dark:to-violet-950/40">
      <div
        className={`transition-opacity duration-300 ${
          isRedirecting ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="mx-auto max-w-6xl px-4 py-10 lg:py-16">
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-10">
          <div className="flex flex-col justify-center">
            <div className="inline-flex items-center gap-2 text-sm text-violet-800/80 dark:text-violet-200/80">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-violet-600 text-white shadow">
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6v6l4 2"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </span>
              ChatGPT Team 邀请系统
            </div>
            <h1 className="mt-4 text-3xl lg:text-4xl font-semibold tracking-tight text-zinc-900 dark:text-white">
              快速加入团队
            </h1>
            <p className="mt-3 text-base text-zinc-700 dark:text-zinc-300">
              输入邀请码与邮箱地址，系统会自动发送 Team 邀请，并提供状态查询。
            </p>

            <div className="mt-6 grid gap-3 text-sm text-zinc-700 dark:text-zinc-300">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-md bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                自动邀请：提交后自动发送邀请邮件
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-md bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                状态追踪：随时查看处理进度与结果
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-md bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                隐私保护：状态页仅显示脱敏邮箱
              </div>
            </div>

            <div className="mt-8">
              <Link
                href={adminHref}
                onClick={handleAdminClick}
                className="inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors"
              >
                管理员登录
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-violet-200/60 dark:border-violet-500/20 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shadow-xl p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">
                  申请邀请
                </h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                  提交后会自动校验邀请码并发送邀请
                </p>
              </div>
              <span className="inline-flex items-center rounded-full bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200 px-3 py-1 text-xs font-medium">
                安全校验
              </span>
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <div>
                <label
                  htmlFor="code"
                  className="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-2"
                >
                  邀请码
                </label>
                <input
                  type="text"
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.trim())}
                  className="w-full px-4 py-3 rounded-xl border border-zinc-300/80 dark:border-zinc-700 bg-white/90 dark:bg-zinc-800/80 text-zinc-900 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
                  placeholder="请输入邀请码（如：AbcD1234...）"
                  required
                  autoComplete="off"
                />
              </div>

              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-2"
                >
                  邮箱地址
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value.trim())}
                  className="w-full px-4 py-3 rounded-xl border border-zinc-300/80 dark:border-zinc-700 bg-white/90 dark:bg-zinc-800/80 text-zinc-900 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
                  placeholder="name@example.com"
                  required
                />
              </div>

              {error && (
                <div className="p-4 bg-red-50/80 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 px-4 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-zinc-900"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    处理中...
                  </>
                ) : (
                  "申请邀请"
                )}
              </button>

              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                提交即视为同意使用该邮箱接收 Team 邀请邮件。
              </p>
            </form>
          </div>
        </div>
        </div>
      </div>
      {isRedirecting && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-3 rounded-2xl border border-violet-200/70 bg-white/90 px-4 py-3 text-sm text-zinc-700 shadow-lg dark:border-violet-500/20 dark:bg-zinc-900/80 dark:text-zinc-200">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-600 border-t-transparent dark:border-violet-400 dark:border-t-transparent" />
            正在进入管理后台...
          </div>
        </div>
      )}
    </div>
  );
}
