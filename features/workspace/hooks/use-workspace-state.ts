"use client";
import { useSessionDraft } from "@/features/conversation/use-session-draft";
import { type SshTerminalTarget } from "@/app/components/ssh-terminal";
import { useRef, useState } from "react";
import type {
  Agent,
  AuthProfilesState,
  AuthRestartJob,
  DeviceLoginJob,
  DialogueCategory,
  DialogueSnapshot,
  InstructionAttachment,
  ModelOption,
  RemoteDirectoryListing,
  ResearchAssistantMessage,
  SessionSummary,
  Snapshot,
} from "../types";

import {
  DEFAULT_INSPECTOR_WIDTH,
  DIALOGUE_RENDER_BATCH,
  SESSION_RENDER_BATCH,
  emptySnapshot,
} from "@/features/workspace/shared";

export function useWorkspaceState() {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [bridgeState, setBridgeState] = useState<
    "connecting" | "connected" | "offline"
  >("connecting");
  const [viewMode, setViewMode] = useState<
    "agents" | "history" | "experiments"
  >("agents");
  const [hostFilter, setHostFilter] = useState("all");
  const [cwdFilter, setCwdFilter] = useState("all");
  const [projectBusyKey, setProjectBusyKey] = useState("");
  const [conversationFocus, setConversationFocus] = useState(false);
  const [gpuFilter, setGpuFilter] = useState("all");
  const [gpuWindow, setGpuWindow] = useState<
    "active" | "1h" | "6h" | "24h" | "168h"
  >("6h");
  const [historyLimit, setHistoryLimit] = useState(100);
  const [historyOrder, setHistoryOrder] = useState<"recent" | "oldest">(
    "recent",
  );
  const [historyState, setHistoryState] = useState<{
    sessions: Agent[];
    scannedAt: string | null;
    scope: string;
    hosts: Array<{
      host: string;
      totalFiles: number;
      truncated: boolean;
      returned: number;
      error: string | null;
    }>;
    loading: boolean;
    error: string;
  }>({
    sessions: [],
    scannedAt: null,
    scope: "",
    hosts: [],
    loading: false,
    error: "",
  });
  const [statusFilter, setStatusFilter] = useState<
    "all" | "working" | "idle" | "attention"
  >("all");
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | SessionSummary["category"]
  >("all");
  const [query, setQuery] = useState("");
  const [sessionRenderLimit, setSessionRenderLimit] =
    useState(SESSION_RENDER_BATCH);
  const [agentOrderRevision, setAgentOrderRevision] = useState(0);
  const [activeAgentOrder, setActiveAgentOrder] = useState<{
    scope: string;
    keys: string[];
  }>({ scope: "", keys: [] });
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedExperimentId, setSelectedExperimentId] = useState<
    string | null
  >(null);
  const [copied, setCopied] = useState("");
  const [mobileHostsOpen, setMobileHostsOpen] = useState(false);
  const [hostSidebarCollapsed, setHostSidebarCollapsed] = useState(false);
  const [uiTheme, setUiTheme] = useState<"dark" | "light">("light");
  const [operatorEditorOpen, setOperatorEditorOpen] = useState(false);
  const [operatorNameDraft, setOperatorNameDraft] = useState("");
  const [sshTerminalTarget, setSshTerminalTarget] =
    useState<SshTerminalTarget | null>(null);
  const [policyDraft, setPolicyDraft] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState("");
  const [planInputDrafts, setPlanInputDrafts] = useState<
    Record<string, Record<string, string>>
  >({});
  const [elicitationDrafts, setElicitationDrafts] = useState<
    Record<string, Record<string, string | boolean | string[]>>
  >({});
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [dialogueRefresh, setDialogueRefresh] = useState(0);
  const [dialogueOrder, setDialogueOrder] = useState<"asc" | "desc">("desc");
  const [dialogueFilters, setDialogueFilters] = useState<
    Record<DialogueCategory, boolean>
  >({
    dialogue: true,
    operations: true,
    reasoning: true,
    subagent: true,
  });
  const [expandedDialogueEvents, setExpandedDialogueEvents] = useState<
    Set<string>
  >(new Set());
  const [dialogueRenderLimit, setDialogueRenderLimit] = useState(
    DIALOGUE_RENDER_BATCH,
  );
  const [inspectorSectionOpen, setInspectorSectionOpen] = useState<
    Record<string, boolean>
  >({});
  const [dialogueState, setDialogueState] = useState<{
    key: string;
    loading: boolean;
    data: DialogueSnapshot | null;
    error: string;
  }>({ key: "", loading: false, data: null, error: "" });
  const [dialogueLoadingMore, setDialogueLoadingMore] = useState(false);
  const [themeEdit, setThemeEdit] = useState<{
    key: string;
    value: string;
  } | null>(null);
  const [inlineRename, setInlineRename] = useState<{
    key: string;
    value: string;
  } | null>(null);
  const [actionNotice, setActionNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskDirectoryBrowser, setNewTaskDirectoryBrowser] = useState<{
    open: boolean;
    loading: boolean;
    error: string;
    listing: RemoteDirectoryListing | null;
  }>({ open: false, loading: false, error: "", listing: null });
  const [accountProfilesOpen, setAccountProfilesOpen] = useState(false);
  const [accountHost, setAccountHost] = useState("");
  const accountHostRef = useRef("");
  const accountProfilesRequestRef = useRef(0);
  const [accountProfiles, setAccountProfiles] =
    useState<AuthProfilesState | null>(null);
  const [accountProfilesLoading, setAccountProfilesLoading] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [deviceLoginJob, setDeviceLoginJob] = useState<DeviceLoginJob | null>(
    null,
  );
  const [authRestartJob, setAuthRestartJob] = useState<AuthRestartJob | null>(
    null,
  );
  const [modelsByHost, setModelsByHost] = useState<
    Record<string, ModelOption[]>
  >({});
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
  const [modelRefresh, setModelRefresh] = useState(0);
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({});
  const [hostModelOpen, setHostModelOpen] = useState(false);
  const [hostSettingsOpen, setHostSettingsOpen] = useState(false);
  const [hostModelDrafts, setHostModelDrafts] = useState<
    Record<string, string>
  >({});
  const [hostModelResults, setHostModelResults] = useState<
    Record<
      string,
      { sessionId: string; status: string; reason?: string; error?: string }[]
    >
  >({});
  const [effortDrafts, setEffortDrafts] = useState<Record<string, string>>({});
  const [yoloDrafts, setYoloDrafts] = useState<Record<string, boolean>>({});
  const [recoveryCwdDrafts, setRecoveryCwdDrafts] = useState<
    Record<string, string>
  >({});
  const [recoveryYoloDrafts, setRecoveryYoloDrafts] = useState<
    Record<string, boolean>
  >({});
  const [submissionTrackerOpen, setSubmissionTrackerOpen] = useState(false);
  const [submissionWindowDays, setSubmissionWindowDays] = useState(1);
  const [showDlcCandidates, setShowDlcCandidates] = useState(false);
  const [researchAssistantOpen, setResearchAssistantOpen] = useState(false);
  const [researchAssistantDraft, setResearchAssistantDraft] = useState("");
  const [researchAssistantBusy, setResearchAssistantBusy] = useState(false);
  const [researchAssistantMessages, setResearchAssistantMessages] = useState<
    ResearchAssistantMessage[]
  >([
    {
      id: "welcome",
      role: "assistant",
      text: "想找哪个实验或任务？描述关键词，我会查找相关会话并列出证据。",
      model: "retrieval-only",
    },
  ]);
  const [newTaskDraft, setNewTaskDraft] = useState({
    host: "",
    cwd: "",
    prompt: "",
    model: "",
    effort: "",
    preLaunchCommand: "",
    yolo: true,
    transport: "app-server" as "app-server" | "tmux",
  });
  const [instructionDraft, setInstructionDraft] =
    useSessionDraft(selectedAgentId);
  const [instructionAttachments, setInstructionAttachments] = useState<
    InstructionAttachment[]
  >([]);
  const [pendingInstruction, setPendingInstruction] = useState<{
    key: string;
    sentAt: number;
    baselineAssistant: string;
    baselineAssistantId?: string;
    transport: "app-server" | "tmux";
    target: string;
  } | null>(null);
  const instructionAttemptRef = useRef<{
    key: string;
    signature: string;
    deliveryId: string;
  } | null>(null);
  const instructionAttachmentOwnerRef = useRef("");
  const instructionAttachmentsRef = useRef<InstructionAttachment[]>([]);
  const instructionFileInputRef = useRef<HTMLInputElement>(null);
  const monitorColumnsRef = useRef<HTMLDivElement>(null);
  const researchAssistantMessagesRef = useRef<HTMLDivElement>(null);
  const resizeActiveRef = useRef(false);
  const [inspectorWidth, setInspectorWidth] = useState(DEFAULT_INSPECTOR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  return {
    snapshot,
    setSnapshot,
    bridgeState,
    setBridgeState,
    viewMode,
    setViewMode,
    hostFilter,
    setHostFilter,
    cwdFilter,
    setCwdFilter,
    projectBusyKey,
    setProjectBusyKey,
    conversationFocus,
    setConversationFocus,
    gpuFilter,
    setGpuFilter,
    gpuWindow,
    setGpuWindow,
    historyLimit,
    setHistoryLimit,
    historyOrder,
    setHistoryOrder,
    historyState,
    setHistoryState,
    statusFilter,
    setStatusFilter,
    categoryFilter,
    setCategoryFilter,
    query,
    setQuery,
    sessionRenderLimit,
    setSessionRenderLimit,
    agentOrderRevision,
    setAgentOrderRevision,
    activeAgentOrder,
    setActiveAgentOrder,
    selectedAgentId,
    setSelectedAgentId,
    selectedExperimentId,
    setSelectedExperimentId,
    copied,
    setCopied,
    mobileHostsOpen,
    setMobileHostsOpen,
    hostSidebarCollapsed,
    setHostSidebarCollapsed,
    uiTheme,
    setUiTheme,
    operatorEditorOpen,
    setOperatorEditorOpen,
    operatorNameDraft,
    setOperatorNameDraft,
    sshTerminalTarget,
    setSshTerminalTarget,
    policyDraft,
    setPolicyDraft,
    busyAction,
    setBusyAction,
    planInputDrafts,
    setPlanInputDrafts,
    elicitationDrafts,
    setElicitationDrafts,
    clockNow,
    setClockNow,
    dialogueRefresh,
    setDialogueRefresh,
    dialogueOrder,
    setDialogueOrder,
    dialogueFilters,
    setDialogueFilters,
    expandedDialogueEvents,
    setExpandedDialogueEvents,
    dialogueRenderLimit,
    setDialogueRenderLimit,
    inspectorSectionOpen,
    setInspectorSectionOpen,
    dialogueState,
    setDialogueState,
    dialogueLoadingMore,
    setDialogueLoadingMore,
    themeEdit,
    setThemeEdit,
    inlineRename,
    setInlineRename,
    actionNotice,
    setActionNotice,
    newTaskOpen,
    setNewTaskOpen,
    newTaskDirectoryBrowser,
    setNewTaskDirectoryBrowser,
    accountProfilesOpen,
    setAccountProfilesOpen,
    accountHost,
    setAccountHost,
    accountHostRef,
    accountProfilesRequestRef,
    accountProfiles,
    setAccountProfiles,
    accountProfilesLoading,
    setAccountProfilesLoading,
    profileNameDraft,
    setProfileNameDraft,
    deviceLoginJob,
    setDeviceLoginJob,
    authRestartJob,
    setAuthRestartJob,
    modelsByHost,
    setModelsByHost,
    modelDrafts,
    setModelDrafts,
    modelRefresh,
    setModelRefresh,
    modelErrors,
    setModelErrors,
    hostModelOpen,
    setHostModelOpen,
    hostSettingsOpen,
    setHostSettingsOpen,
    hostModelDrafts,
    setHostModelDrafts,
    hostModelResults,
    setHostModelResults,
    effortDrafts,
    setEffortDrafts,
    yoloDrafts,
    setYoloDrafts,
    recoveryCwdDrafts,
    setRecoveryCwdDrafts,
    recoveryYoloDrafts,
    setRecoveryYoloDrafts,
    submissionTrackerOpen,
    setSubmissionTrackerOpen,
    submissionWindowDays,
    setSubmissionWindowDays,
    showDlcCandidates,
    setShowDlcCandidates,
    researchAssistantOpen,
    setResearchAssistantOpen,
    researchAssistantDraft,
    setResearchAssistantDraft,
    researchAssistantBusy,
    setResearchAssistantBusy,
    researchAssistantMessages,
    setResearchAssistantMessages,
    newTaskDraft,
    setNewTaskDraft,
    instructionDraft,
    setInstructionDraft,
    instructionAttachments,
    setInstructionAttachments,
    pendingInstruction,
    setPendingInstruction,
    instructionAttemptRef,
    instructionAttachmentOwnerRef,
    instructionAttachmentsRef,
    instructionFileInputRef,
    monitorColumnsRef,
    researchAssistantMessagesRef,
    resizeActiveRef,
    inspectorWidth,
    setInspectorWidth,
    isResizing,
    setIsResizing,
  };
}
