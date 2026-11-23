"use client";
import { Check, KeyRound, LoaderCircle, Trash2 } from "lucide-react";
import { QuotaInlineBadge } from "@/components/quota-meter";
import { relativeTime } from "../workspace/shared";
import type { HostProfileQuotaEntry } from "../workspace/types";
import type { WorkspaceController } from "../workspace/use-workspace-controller";
export function AccountProfileList({
  accountProfiles,
  accountProfilesLoading,
  busyAction,
  activateAuthProfile,
  deleteAuthProfile,
  profileQuotas,
  quotasLoading,
}: Pick<
  WorkspaceController,
  | "accountProfiles"
  | "accountProfilesLoading"
  | "busyAction"
  | "activateAuthProfile"
  | "deleteAuthProfile"
> & {
  profileQuotas?: Record<string, HostProfileQuotaEntry>;
  quotasLoading?: boolean;
}) {
  return (
    <div className="auth-profile-list">
      <div className="auth-profile-list-head">
        <strong>已保存账号</strong>
        <span>{accountProfiles?.profiles.length || 0} 个</span>
      </div>
      {accountProfilesLoading && !accountProfiles ? (
        <div className="submission-empty">
          <LoaderCircle size={17} className="is-spinning" />
          正在读取账号…
        </div>
      ) : accountProfiles?.profiles.length ? (
        accountProfiles.profiles.map((profile) => (
          <article
            className={profile.active ? "active" : ""}
            key={profile.slug}
            title={
              profile.updatedAt
                ? `更新 ${relativeTime(profile.updatedAt)}`
                : profile.slug
            }
          >
            <div>
              <div className="account-profile-name">
                <strong>{profile.name}</strong>
                {profile.account?.planType &&
                  profile.account.planType !== "unknown" && (
                    <small className="account-plan">
                      {profile.account.planType}
                    </small>
                  )}
                <QuotaInlineBadge
                  quota={profileQuotas?.[profile.slug]?.quota}
                  loading={Boolean(
                    quotasLoading &&
                      profile.ready &&
                      !profileQuotas?.[profile.slug],
                  )}
                />
              </div>
              <span title={profile.account?.email || undefined}>
                {profile.account?.email ||
                  (profile.ready ? "未识别账号信息" : "尚未登录")}
              </span>
            </div>
            <div className="auth-profile-actions">
              <button
                type="button"
                className={profile.active ? "profile-active" : "inline-action"}
                disabled={
                  profile.active ||
                  !profile.ready ||
                  busyAction === `profile-activate:${profile.slug}` ||
                  busyAction === `profile-delete:${profile.slug}`
                }
                onClick={() => activateAuthProfile(profile)}
              >
                {busyAction === `profile-activate:${profile.slug}` ? (
                  <LoaderCircle size={14} className="is-spinning" />
                ) : profile.active ? (
                  <Check size={14} />
                ) : (
                  <KeyRound size={14} />
                )}
                {profile.active ? "已选配置" : "切换"}
              </button>
              <button
                type="button"
                className="profile-delete-action"
                aria-label={`删除 Profile ${profile.name}`}
                title={
                  profile.active
                    ? "当前 Profile 不能删除，请先切换账号"
                    : `删除 ${profile.name}`
                }
                disabled={
                  profile.active ||
                  busyAction === `profile-delete:${profile.slug}` ||
                  busyAction === `profile-activate:${profile.slug}`
                }
                onClick={() => deleteAuthProfile(profile)}
              >
                {busyAction === `profile-delete:${profile.slug}` ? (
                  <LoaderCircle size={14} className="is-spinning" />
                ) : (
                  <Trash2 size={14} />
                )}
              </button>
            </div>
          </article>
        ))
      ) : (
        <div className="submission-empty">
          暂无已保存账号。展开“添加账号”保存当前登录，或登录其他账号。
        </div>
      )}
    </div>
  );
}
