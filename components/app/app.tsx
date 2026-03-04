'use client';

import { useMemo, useState } from 'react';
import { useSession } from '@livekit/components-react';
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

export function App({ appConfig }: AppProps) {
  const [resume, setResume] = useState('');
  const defaultAgentName =
    process.env.NEXT_PUBLIC_DEFAULT_AGENT_NAME ?? appConfig.agentName ?? 'my-agent';
  const dynamicAgentName = process.env.NEXT_PUBLIC_DYNAMIC_AGENT_NAME ?? 'dynamic-agent';
  const [selectedAgentName, setSelectedAgentName] = useState(defaultAgentName);

  const tokenSource = useMemo(() => {
    return typeof process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT === 'string'
      ? getSandboxTokenSource(appConfig, resume, selectedAgentName)
      : getEndpointTokenSource(appConfig, resume, selectedAgentName);
  }, [appConfig, resume, selectedAgentName]);

  const session = useSession(
    tokenSource,
    selectedAgentName ? { agentName: selectedAgentName } : undefined
  );

  return (
    <AgentSessionProvider session={session}>
      <AppSetup />
      <main className="grid h-svh grid-cols-1 place-content-center">
        <ViewController
          appConfig={appConfig}
          resume={resume}
          onResumeChange={setResume}
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
