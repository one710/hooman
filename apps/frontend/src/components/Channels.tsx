import { useState, useEffect, useCallback } from "react";
import createDebug from "debug";
import { SlidersHorizontal, FileJson } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { getChannels, patchChannels, getWhatsAppConnection } from "../api";

const debug = createDebug("hooman:Channels");

/** Slack app manifest for creating an app with Socket Mode and scopes required by Hooman. */
const SLACK_APP_MANIFEST = {
  _metadata: { major_version: 1 },
  display_information: {
    name: "Hooman",
    description:
      "Inbound Slack channel for Hooman. Receives messages in DMs, channels, and groups.",
    background_color: "#1a1a2e",
  },
  features: {
    bot_user: {
      display_name: "Hooman",
      always_online: false,
    },
  },
  oauth_config: {
    scopes: {
      bot: [
        "app_mentions:read",
        "chat:write",
        "channels:history",
        "channels:read",
        "groups:history",
        "groups:read",
        "im:history",
        "im:read",
        "users:read",
      ],
      user: [
        "channels:history",
        "channels:read",
        "groups:history",
        "groups:read",
        "im:history",
        "im:read",
        "users:read",
      ],
    },
  },
  settings: {
    event_subscriptions: {
      bot_events: ["message.channels", "message.groups", "message.im"],
    },
    org_deploy_enabled: false,
    socket_mode_enabled: true,
    token_rotation_enabled: false,
  },
} as const;
import type { ChannelEntry } from "../api";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { Radio } from "./Radio";
import { useDialog } from "./Dialog";
import { Input } from "./Input";
import { Modal } from "./Modal";
import { Select } from "./Select";

export function Channels() {
  const dialog = useDialog();
  const [channels, setChannels] = useState<Record<string, ChannelEntry> | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [configModalChannel, setConfigModalChannel] = useState<string | null>(
    null,
  );
  const [slackManifestOpen, setSlackManifestOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  function load() {
    getChannels()
      .then((r) => {
        setChannels(r.channels ?? {});
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleEnabled(
    id: string,
    current: ChannelEntry,
    next: boolean,
  ) {
    if (current.alwaysOn || current.config === null) return;
    const ok = await dialog.confirm({
      title: next ? "Turn on channel?" : "Turn off channel?",
      message: next
        ? `Enable ${current.name}? Incoming messages will be processed.`
        : `Disable ${current.name}? Incoming messages will no longer be processed.`,
      confirmLabel: next ? "Turn on" : "Turn off",
      variant: next ? "default" : "danger",
    });
    if (!ok) return;
    setSaving(id);
    try {
      const patch: Record<string, unknown> = {};
      if (id === "slack") patch.slack = { ...current.config, enabled: next };
      if (id === "email") patch.email = { ...current.config, enabled: next };
      if (id === "whatsapp")
        patch.whatsapp = { ...current.config, enabled: next };
      if (id === "jira") patch.jira = { ...current.config, enabled: next };
      await patchChannels(patch);
      load();
    } catch (e) {
      debug("%o", e);
    } finally {
      setSaving(null);
    }
  }

  async function saveChannel(id: string, config: Record<string, unknown>) {
    setSaving(id);
    try {
      const patch: Record<string, unknown> = {};
      if (id === "slack") patch.slack = config;
      if (id === "email") patch.email = config;
      if (id === "whatsapp") patch.whatsapp = config;
      if (id === "jira") patch.jira = config;
      await patchChannels(patch);
      setConfigModalChannel(null);
      load();
    } catch (e) {
      debug("%o", e);
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full min-h-0 p-4 md:p-6">
        <p className="text-hooman-muted text-sm">Loading channels…</p>
      </div>
    );
  }

  const order = ["web", "slack", "email", "whatsapp", "jira"];
  const list = order
    .map((id) => channels?.[id])
    .filter(Boolean) as ChannelEntry[];

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="border-b border-hooman-border px-4 md:px-6 py-3 md:py-4 shrink-0">
        <h2 className="text-base md:text-lg font-semibold text-white">
          Channels
        </h2>
        <p className="text-xs md:text-sm text-hooman-muted">
          Manage where Hooman receives messages (web, Slack, email, Jira).
          Sending is handled by colleagues.
        </p>
      </header>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 min-h-0">
        {list.map((ch) => (
          <ChannelCard
            key={ch.id}
            channel={ch}
            onOpenConfigure={() => setConfigModalChannel(ch.id)}
            onOpenManifest={
              ch.id === "slack" ? () => setSlackManifestOpen(true) : undefined
            }
            onToggleEnabled={(next) => toggleEnabled(ch.id, ch, next)}
            saving={saving === ch.id}
          />
        ))}
      </div>
      {configModalChannel && channels?.[configModalChannel] && (
        <ConfigModal
          channel={channels[configModalChannel]}
          onClose={() => setConfigModalChannel(null)}
          onSave={(config) => saveChannel(configModalChannel, config)}
          saving={saving === configModalChannel}
        />
      )}
      {slackManifestOpen && (
        <SlackManifestModal onClose={() => setSlackManifestOpen(false)} />
      )}
    </div>
  );
}

function ChannelCard({
  channel: ch,
  onOpenConfigure,
  onOpenManifest,
  onToggleEnabled,
  saving,
}: {
  channel: ChannelEntry;
  onOpenConfigure: () => void;
  onOpenManifest?: () => void;
  onToggleEnabled: (next: boolean) => void;
  saving: boolean;
}) {
  const canConfigure = !ch.alwaysOn;

  return (
    <div className="rounded-xl border border-hooman-border bg-hooman-surface overflow-hidden">
      <div className="flex items-center justify-between p-4">
        <div>
          <h3 className="font-medium text-white">{ch.name}</h3>
          {ch.alwaysOn ? (
            <p className="text-xs text-hooman-muted">Always on</p>
          ) : (
            <p className="text-xs text-hooman-muted">
              {ch.enabled ? "Enabled" : "Disabled"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!ch.alwaysOn && (
            <Button
              type="button"
              variant={ch.enabled ? "success" : "danger"}
              size="sm"
              onClick={() => onToggleEnabled(!ch.enabled)}
              disabled={saving || ch.config === null}
            >
              {ch.enabled ? "On" : "Off"}
            </Button>
          )}
          {canConfigure && (
            <Button
              variant="secondary"
              size="sm"
              icon={<SlidersHorizontal className="w-4 h-4" />}
              onClick={onOpenConfigure}
            >
              Configure
            </Button>
          )}
          {onOpenManifest && (
            <Button
              variant="secondary"
              size="sm"
              icon={<FileJson className="w-4 h-4" />}
              onClick={onOpenManifest}
            >
              Manifest
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SlackManifestModal({ onClose }: { onClose: () => void }) {
  const manifestJson = JSON.stringify(SLACK_APP_MANIFEST, null, 2);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(manifestJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Slack app manifest"
      maxWidth="2xl"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={copy}>
            {copied ? "Copied!" : "Copy to clipboard"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <p className="text-sm text-hooman-muted mb-3">
        Create a Slack app from this manifest to get the right scopes for Hooman
        (Socket Mode, read messages in channels/DMs/groups). In Slack: Create an
        app → From an app manifest → paste the JSON below. Then create an
        App-level token with{" "}
        <code className="text-xs bg-hooman-muted/20 px-1 rounded">
          connections:write
        </code>{" "}
        and install the app to get the User OAuth token.
      </p>
      <pre className="text-xs text-zinc-400 bg-hooman-muted/10 border border-hooman-border rounded-lg p-4 overflow-x-auto overflow-y-auto max-h-[60vh] font-mono whitespace-pre-wrap select-text">
        {manifestJson}
      </pre>
    </Modal>
  );
}

type WhatsAppConnection = {
  status: "disconnected" | "pairing" | "connected";
  qr?: string;
  selfId?: string;
  selfNumber?: string;
};

function ConfigModal({
  channel,
  onClose,
  onSave,
  saving,
}: {
  channel: ChannelEntry;
  onClose: () => void;
  onSave: (config: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const config = channel.config ?? {};
  const formId = "channel-config-form";
  const [whatsAppConn, setWhatsAppConn] = useState<WhatsAppConnection | null>(
    null,
  );
  const isWhatsApp = channel.id === "whatsapp";

  const fetchWhatsAppConnection = useCallback(async () => {
    const data = await getWhatsAppConnection();
    setWhatsAppConn(data);
  }, []);

  useEffect(() => {
    if (!isWhatsApp || !channel.enabled) return;
    void fetchWhatsAppConnection();
    const t = setInterval(fetchWhatsAppConnection, 2500);
    return () => clearInterval(t);
  }, [isWhatsApp, channel.enabled, fetchWhatsAppConnection]);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Configure ${channel.name}`}
      maxWidth="lg"
      footer={
        <div className="flex gap-2">
          <Button
            variant="success"
            type="submit"
            form={formId}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      }
    >
      {isWhatsApp && (
        <WhatsAppConnectionBlock
          connection={whatsAppConn}
          enabled={!!channel.enabled}
        />
      )}
      {channel.id === "slack" && (
        <SlackConfigForm
          id={formId}
          config={config}
          onSave={onSave}
          saving={saving}
        />
      )}
      {channel.id === "email" && (
        <EmailConfigForm
          id={formId}
          config={config}
          onSave={onSave}
          saving={saving}
        />
      )}
      {channel.id === "whatsapp" && (
        <WhatsAppConfigForm
          id={formId}
          config={config}
          onSave={onSave}
          saving={saving}
        />
      )}
      {channel.id === "jira" && (
        <JiraConfigForm
          id={formId}
          config={config}
          onSave={onSave}
          saving={saving}
        />
      )}
    </Modal>
  );
}

function WhatsAppConnectionBlock({
  connection,
  enabled,
}: {
  connection: WhatsAppConnection | null;
  enabled: boolean;
}) {
  if (!enabled) {
    return (
      <div className="mb-4 p-4 rounded-lg bg-hooman-muted/10 border border-hooman-border">
        <p className="text-sm text-hooman-muted">
          Enable the channel and save to start linking your WhatsApp device.
        </p>
      </div>
    );
  }
  const status = connection?.status ?? "disconnected";
  return (
    <div className="mb-4 p-4 rounded-lg bg-hooman-muted/10 border border-hooman-border">
      <p className="text-sm font-medium text-white mb-2">Link device</p>
      {status === "connected" && (
        <p className="text-sm text-green-500">
          Linked
          {connection?.selfNumber || connection?.selfId
            ? ` — Connected as ${connection.selfNumber ?? connection.selfId}`
            : " — WhatsApp is connected."}
        </p>
      )}
      {status === "pairing" && connection?.qr && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-hooman-muted">
            Scan this QR code with WhatsApp on your phone (Linked Devices).
          </p>
          <div className="p-3 bg-white rounded-lg inline-block">
            <QRCodeSVG value={connection.qr} size={256} level="M" />
          </div>
        </div>
      )}
      {(status === "disconnected" || (!connection && enabled)) && (
        <p className="text-sm text-hooman-muted">
          Connecting… Make sure the channel is enabled and the worker is
          running.
        </p>
      )}
    </div>
  );
}

function SlackConfigForm({
  id,
  config,
  onSave,
  saving,
}: {
  id: string;
  config: Record<string, unknown>;
  onSave: (c: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const connectAsOptions = [
    { value: "bot", label: "Bot" },
    { value: "user", label: "User" },
  ] as const;
  const [connectAs, setConnectAs] = useState<"bot" | "user">(
    (config.connectAs as "bot" | "user") ?? "user",
  );
  const [appToken, setAppToken] = useState(String(config.appToken ?? ""));
  const [userToken, setUserToken] = useState(String(config.userToken ?? ""));
  const [designatedUserId, setDesignatedUserId] = useState(
    String(config.designatedUserId ?? ""),
  );
  const [filterMode, setFilterMode] = useState(
    String(config.filterMode ?? "all"),
  );
  const [filterList, setFilterList] = useState(
    Array.isArray(config.filterList) ? config.filterList.join(", ") : "",
  );

  return (
    <form
      id={id}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          ...config,
          enabled: config.enabled ?? false,
          connectAs,
          appToken: appToken.trim() || undefined,
          userToken: userToken.trim() || undefined,
          designatedUserId:
            connectAs === "user"
              ? designatedUserId.trim() || undefined
              : undefined,
          filterMode: filterMode || "all",
          filterList: filterList
            ? filterList
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        });
      }}
    >
      <div>
        <span className="block text-sm font-medium text-zinc-300 mb-2">
          Connect as
        </span>
        <div className="flex gap-4">
          {connectAsOptions.map((opt) => (
            <Radio
              key={opt.value}
              name="slack-connect-as"
              value={opt.value}
              checked={connectAs === opt.value}
              onChange={() => setConnectAs(opt.value)}
              label={opt.label}
            />
          ))}
        </div>
      </div>
      <Input
        label="App token (xapp-…)"
        type="password"
        placeholder="Leave blank to keep current"
        value={appToken}
        onChange={(e) => setAppToken(e.target.value)}
      />
      <Input
        label={
          connectAs === "bot" ? "Bot token (xoxb-…)" : "User token (xoxp-…)"
        }
        type="password"
        placeholder="Leave blank to keep current"
        value={userToken}
        onChange={(e) => setUserToken(e.target.value)}
      />
      {connectAs === "user" && (
        <Input
          label="Designated user ID (optional)"
          placeholder="Slack user ID for directness (e.g. U01234…)"
          value={designatedUserId}
          onChange={(e) => setDesignatedUserId(e.target.value)}
        />
      )}
      <Select
        label="Filter mode"
        value={filterMode}
        onChange={(value) => setFilterMode(value)}
        options={[
          { value: "all", label: "All" },
          { value: "allowlist", label: "Allowlist" },
          { value: "blocklist", label: "Blocklist" },
        ]}
      />
      {filterMode !== "all" && (
        <Input
          label="Filter list (comma-separated IDs)"
          placeholder="User or channel IDs"
          value={filterList}
          onChange={(e) => setFilterList(e.target.value)}
        />
      )}
    </form>
  );
}

function EmailConfigForm({
  id,
  config,
  onSave,
  saving,
}: {
  id: string;
  config: Record<string, unknown>;
  onSave: (c: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const imap = (config.imap ?? {}) as Record<string, unknown>;
  const [host, setHost] = useState(String(imap.host ?? ""));
  const [port, setPort] = useState(String(imap.port ?? "993"));
  const [user, setUser] = useState(String(imap.user ?? ""));
  const [password, setPassword] = useState(String(imap.password ?? ""));
  const [tls, setTls] = useState(imap.tls !== false);
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState(
    String(
      Math.max(1, Math.round((Number(config.pollIntervalMs) || 60000) / 60000)),
    ),
  );
  const [folders, setFolders] = useState(
    Array.isArray(config.folders) ? config.folders.join(", ") : "INBOX",
  );
  const [identityAddresses, setIdentityAddresses] = useState(
    Array.isArray(config.identityAddresses)
      ? config.identityAddresses.join(", ")
      : "",
  );
  const [filterMode, setFilterMode] = useState(
    String(config.filterMode ?? "all"),
  );
  const [filterList, setFilterList] = useState(
    Array.isArray(config.filterList) ? config.filterList.join(", ") : "",
  );

  return (
    <form
      id={id}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          ...config,
          enabled: config.enabled ?? false,
          imap: { host, port: parseInt(port, 10) || 993, user, password, tls },
          pollIntervalMs:
            Math.max(1, parseInt(pollIntervalMinutes, 10) || 1) * 60 * 1000,
          folders: folders
            ? folders
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
          identityAddresses: identityAddresses
            ? identityAddresses
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
          filterMode: filterMode || "all",
          filterList: filterList
            ? filterList
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        });
      }}
    >
      <Input
        label="IMAP host"
        value={host}
        onChange={(e) => setHost(e.target.value)}
      />
      <Input
        label="IMAP port"
        type="number"
        value={port}
        onChange={(e) => setPort(e.target.value)}
      />
      <Input
        label="IMAP user"
        value={user}
        onChange={(e) => setUser(e.target.value)}
      />
      <Input
        label="IMAP password"
        type="password"
        placeholder="Leave blank to keep current"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Checkbox
        id="email-tls"
        checked={tls}
        onChange={setTls}
        label="Use TLS"
      />
      <Input
        label="Poll interval (minutes)"
        type="number"
        min={1}
        value={pollIntervalMinutes}
        onChange={(e) => setPollIntervalMinutes(e.target.value)}
      />
      <Input
        label="Folders (comma-separated)"
        placeholder="INBOX"
        value={folders}
        onChange={(e) => setFolders(e.target.value)}
      />
      <Input
        label="Identity addresses (To/CC/BCC, comma-separated)"
        placeholder="me@example.com"
        value={identityAddresses}
        onChange={(e) => setIdentityAddresses(e.target.value)}
      />
      <p className="text-xs text-hooman-muted -mt-2">
        Leave empty to use the IMAP inbox user as your identity for directness.
      </p>
      <Select
        label="Filter mode"
        value={filterMode}
        onChange={(value) => setFilterMode(value)}
        options={[
          { value: "all", label: "All" },
          { value: "allowlist", label: "Allowlist" },
          { value: "blocklist", label: "Blocklist" },
        ]}
      />
      {filterMode !== "all" && (
        <Input
          label="Filter list (addresses/domains, comma-separated)"
          value={filterList}
          onChange={(e) => setFilterList(e.target.value)}
        />
      )}
    </form>
  );
}

function WhatsAppConfigForm({
  id,
  config,
  onSave,
  saving,
}: {
  id: string;
  config: Record<string, unknown>;
  onSave: (c: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [sessionPath, setSessionPath] = useState(
    String(config.sessionPath ?? ""),
  );
  const [filterMode, setFilterMode] = useState(
    String(config.filterMode ?? "all"),
  );
  const [filterList, setFilterList] = useState(
    Array.isArray(config.filterList) ? config.filterList.join(", ") : "",
  );

  return (
    <form
      id={id}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          ...config,
          enabled: config.enabled ?? false,
          sessionPath: sessionPath.trim(),
          filterMode: filterMode || "all",
          filterList: filterList
            ? filterList
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        });
      }}
    >
      <Input
        label="Session folder (optional)"
        placeholder="default"
        value={sessionPath}
        onChange={(e) => setSessionPath(e.target.value)}
      />
      <Select
        label="Filter mode"
        value={filterMode}
        onChange={(value) => setFilterMode(value)}
        options={[
          { value: "all", label: "All" },
          { value: "allowlist", label: "Allowlist" },
          { value: "blocklist", label: "Blocklist" },
        ]}
      />
      {filterMode !== "all" && (
        <Input
          label="Filter list (numbers/group IDs, comma-separated)"
          value={filterList}
          onChange={(e) => setFilterList(e.target.value)}
        />
      )}
    </form>
  );
}

function JiraConfigForm({
  id,
  config,
  onSave,
  saving,
}: {
  id: string;
  config: Record<string, unknown>;
  onSave: (c: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [baseUrl, setBaseUrl] = useState(
    String(config.baseUrl ?? "https://your-domain.atlassian.net"),
  );
  const [email, setEmail] = useState(String(config.email ?? ""));
  const [apiToken, setApiToken] = useState(String(config.apiToken ?? ""));
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState(
    String(
      Math.max(
        1,
        Math.round((Number(config.pollIntervalMs) || 300000) / 60000),
      ),
    ),
  );
  const [jql, setJql] = useState(
    String(config.jql ?? "assignee = currentUser() ORDER BY updated DESC"),
  );
  const [filterMode, setFilterMode] = useState(
    String(config.filterMode ?? "all"),
  );
  const [filterList, setFilterList] = useState(
    Array.isArray(config.filterList) ? config.filterList.join(", ") : "",
  );

  return (
    <form
      id={id}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          ...config,
          enabled: config.enabled ?? false,
          baseUrl: baseUrl.trim(),
          email: email.trim(),
          apiToken: apiToken.trim() || undefined,
          pollIntervalMs:
            Math.max(1, parseInt(pollIntervalMinutes, 10) || 5) * 60 * 1000,
          jql: jql.trim() || undefined,
          filterMode: filterMode || "all",
          filterList: filterList
            ? filterList
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        });
      }}
    >
      <Input
        label="Jira base URL"
        placeholder="https://your-domain.atlassian.net"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
      />
      <Input
        label="Atlassian account email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Input
        label="API token"
        type="password"
        placeholder="Leave blank to keep current (from id.atlassian.com)"
        value={apiToken}
        onChange={(e) => setApiToken(e.target.value)}
      />
      <Input
        label="Poll interval (minutes)"
        type="number"
        min={1}
        value={pollIntervalMinutes}
        onChange={(e) => setPollIntervalMinutes(e.target.value)}
      />
      <Input
        label="JQL (optional)"
        placeholder="assignee = currentUser() ORDER BY updated DESC"
        value={jql}
        onChange={(e) => setJql(e.target.value)}
      />
      <Select
        label="Filter mode (by project)"
        value={filterMode}
        onChange={(value) => setFilterMode(value)}
        options={[
          { value: "all", label: "All projects" },
          { value: "allowlist", label: "Allowlist" },
          { value: "blocklist", label: "Blocklist" },
        ]}
      />
      {filterMode !== "all" && (
        <Input
          label="Filter list (project keys, comma-separated)"
          placeholder="PROJ, DEV"
          value={filterList}
          onChange={(e) => setFilterList(e.target.value)}
        />
      )}
    </form>
  );
}
