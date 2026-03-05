'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession, useSessionMessages } from '@livekit/components-react';
import { WarningIcon } from '@phosphor-icons/react/dist/ssr';
import type { AppConfig } from '@/app-config';
import { AgentSessionProvider } from '@/components/agents-ui/agent-session-provider';
import { StartAudioButton } from '@/components/agents-ui/start-audio-button';
import { ViewController } from '@/components/app/view-controller';
import { Toaster } from '@/components/ui/sonner';
import { useAgentErrors } from '@/hooks/useAgentErrors';
import { useDebugMode } from '@/hooks/useDebug';
import { getEndpointTokenSource, getSandboxTokenSource } from '@/lib/utils';

const IN_DEVELOPMENT = process.env.NODE_ENV !== 'production';

function AppSetup() {
  useDebugMode({ enabled: IN_DEVELOPMENT });
  useAgentErrors();

  return null;
}

interface AppProps {
  appConfig: AppConfig;
}

type ResumeInputMode = 'text' | 'pdf';

interface SessionMessageLike {
  id: string;
  type?: string;
  timestamp?: number;
  message?: unknown;
  from?: {
    identity?: string;
    name?: string;
    isLocal?: boolean;
  };
}

function serializeTranscript(messages: SessionMessageLike[]) {
  return messages
    .map((message) => {
      const text = typeof message.message === 'string' ? message.message.trim() : '';
      if (!text) {
        return null;
      }

      return {
        id: message.id,
        type: message.type ?? 'chatMessage',
        message: text,
        timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
        fromIdentity: message.from?.identity ?? null,
        fromName: message.from?.name ?? null,
        isLocal: typeof message.from?.isLocal === 'boolean' ? message.from.isLocal : null,
      };
    })
    .filter((message): message is NonNullable<typeof message> => message !== null);
}

export function App({ appConfig }: AppProps) {
  const [resume, setResume] = useState('');
  const [resumeInputMode, setResumeInputMode] = useState<ResumeInputMode>('text');
  const configuredDefaultAgentName =
    process.env.NEXT_PUBLIC_DEFAULT_AGENT_NAME ?? appConfig.agentName ?? 'my-agent';
  const defaultAgentName = process.env.NEXT_PUBLIC_DEFAULT_AGENT_NAME ?? configuredDefaultAgentName;
  const dynamicAgentName = process.env.NEXT_PUBLIC_DYNAMIC_AGENT_NAME ?? 'dynamic-agent';
  const dispatchAgentName = configuredDefaultAgentName;
  const [selectedAgentName, setSelectedAgentName] = useState(configuredDefaultAgentName);
  const selectedPromptProfile = selectedAgentName === dynamicAgentName ? 'dynamic' : 'main';

  const tokenSource = useMemo(() => {
    return typeof process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT === 'string'
      ? getSandboxTokenSource(appConfig, resume, dispatchAgentName, selectedPromptProfile)
      : getEndpointTokenSource(appConfig, resume, dispatchAgentName, selectedPromptProfile);
  }, [appConfig, dispatchAgentName, resume, selectedPromptProfile]);

  const session = useSession(
    tokenSource,
    dispatchAgentName ? { agentName: dispatchAgentName } : undefined
  );
  const { messages } = useSessionMessages(session);
  const callActiveRef = useRef(false);
  const transcriptPersistedRef = useRef(false);
  const callStartedAtRef = useRef<string | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const latestTranscriptRef = useRef<ReturnType<typeof serializeTranscript>>([]);

  useEffect(() => {
    const serialized = serializeTranscript(messages as SessionMessageLike[]);
    if (serialized.length > 0) {
      latestTranscriptRef.current = serialized;
    }
  }, [messages]);

  useEffect(() => {
    if (session.isConnected) {
      if (!callActiveRef.current) {
        callActiveRef.current = true;
        transcriptPersistedRef.current = false;
        callStartedAtRef.current = new Date().toISOString();
        roomNameRef.current = session.room.name || null;
        latestTranscriptRef.current = [];
      }
      return;
    }

    if (!callActiveRef.current || transcriptPersistedRef.current) {
      return;
    }

    callActiveRef.current = false;
    transcriptPersistedRef.current = true;

    const liveTranscript = serializeTranscript(messages as SessionMessageLike[]);
    const transcript = liveTranscript.length > 0 ? liveTranscript : latestTranscriptRef.current;

    void fetch('/api/conversations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roomName: roomNameRef.current,
        agentName: selectedAgentName,
        promptProfile: selectedPromptProfile,
        resume,
        resumeSource: resumeInputMode,
        transcript,
        startedAt: callStartedAtRef.current,
      }),
    }).catch((error) => {
      console.error('Failed to persist conversation:', error);
    });
  }, [
    messages,
    resume,
    resumeInputMode,
    selectedAgentName,
    selectedPromptProfile,
    session.isConnected,
    session.room.name,
  ]);

  return (
    <AgentSessionProvider session={session}>
      <AppSetup />
      <main className="grid h-svh grid-cols-1 place-content-center">
        <ViewController
          appConfig={appConfig}
          resume={resume}
          onResumeChange={setResume}
          resumeInputMode={resumeInputMode}
          onResumeInputModeChange={setResumeInputMode}
          selectedAgentName={selectedAgentName}
          onSelectedAgentNameChange={setSelectedAgentName}
          defaultAgentName={defaultAgentName}
          dynamicAgentName={dynamicAgentName}
        />
      </main>
      <StartAudioButton label="Start Audio" />
      <Toaster
        icons={{
          warning: <WarningIcon weight="bold" />,
        }}
        position="top-center"
        className="toaster group"
        style={
          {
            '--normal-bg': 'var(--popover)',
            '--normal-text': 'var(--popover-foreground)',
            '--normal-border': 'var(--border)',
          } as React.CSSProperties
        }
      />
    </AgentSessionProvider>
  );
}
