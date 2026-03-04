'use client';

import { useCallback } from 'react';
import { useTheme } from 'next-themes';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { useSessionContext } from '@livekit/components-react';
import type { AppConfig } from '@/app-config';
import { AgentSessionView_01 } from '@/components/agents-ui/blocks/agent-session-view-01';
import { WelcomeView } from '@/components/app/welcome-view';

const MotionWelcomeView = motion.create(WelcomeView);
const MotionSessionView = motion.create(AgentSessionView_01);

const VIEW_MOTION_PROPS = {
  variants: {
    visible: {
      opacity: 1,
    },
    hidden: {
      opacity: 0,
    },
  },
  initial: 'hidden',
  animate: 'visible',
  exit: 'hidden',
  transition: {
    duration: 0.5,
    ease: 'linear' as const,
  },
};

interface ViewControllerProps {
  appConfig: AppConfig;
  resume: string;
  onResumeChange: (resume: string) => void;
  resumeInputMode: 'text' | 'pdf';
  onResumeInputModeChange: (mode: 'text' | 'pdf') => void;
  selectedAgentName: string;
  onSelectedAgentNameChange: (agentName: string) => void;
  defaultAgentName: string;
  dynamicAgentName: string;
}

export function ViewController({
  appConfig,
  resume,
  onResumeChange,
  resumeInputMode,
  onResumeInputModeChange,
  selectedAgentName,
  onSelectedAgentNameChange,
  defaultAgentName,
  dynamicAgentName,
}: ViewControllerProps) {
  const { isConnected, start } = useSessionContext();
  const { resolvedTheme } = useTheme();
  const handleStartCall = useCallback(async () => {
    try {
      await start();
    } catch (error) {
      console.error('Failed to start call:', error);
      const rawMessage = error instanceof Error ? error.message : 'Unknown error';
      const isPermissionIssue = /permission|notallowed|denied|microphone|camera/i.test(rawMessage);
      const description = isPermissionIssue
        ? 'Microphone or camera permission is blocked in your browser settings.'
        : rawMessage;

      toast.error('Failed to start call', { description });
    }
  }, [start]);

  return (
    <AnimatePresence mode="wait">
      {/* Welcome view */}
      {!isConnected && (
        <MotionWelcomeView
          key="welcome"
          {...VIEW_MOTION_PROPS}
          startButtonText={appConfig.startButtonText}
          onStartCall={handleStartCall}
          resume={resume}
          onResumeChange={onResumeChange}
          resumeInputMode={resumeInputMode}
          onResumeInputModeChange={onResumeInputModeChange}
          selectedAgentName={selectedAgentName}
          onSelectedAgentNameChange={onSelectedAgentNameChange}
          defaultAgentName={defaultAgentName}
          dynamicAgentName={dynamicAgentName}
        />
      )}
      {/* Session view */}
      {isConnected && (
        <MotionSessionView
          key="session-view"
          {...VIEW_MOTION_PROPS}
          supportsChatInput={appConfig.supportsChatInput}
          supportsVideoInput={appConfig.supportsVideoInput}
          supportsScreenShare={appConfig.supportsScreenShare}
          isPreConnectBufferEnabled={appConfig.isPreConnectBufferEnabled}
          audioVisualizerType={appConfig.audioVisualizerType}
          audioVisualizerColor={
            resolvedTheme === 'dark'
              ? appConfig.audioVisualizerColorDark
              : appConfig.audioVisualizerColor
          }
          audioVisualizerColorShift={appConfig.audioVisualizerColorShift}
          audioVisualizerBarCount={appConfig.audioVisualizerBarCount}
          audioVisualizerGridRowCount={appConfig.audioVisualizerGridRowCount}
          audioVisualizerGridColumnCount={appConfig.audioVisualizerGridColumnCount}
          audioVisualizerRadialBarCount={appConfig.audioVisualizerRadialBarCount}
          audioVisualizerRadialRadius={appConfig.audioVisualizerRadialRadius}
          audioVisualizerWaveLineWidth={appConfig.audioVisualizerWaveLineWidth}
          className="fixed inset-0"
        />
      )}
    </AnimatePresence>
  );
}
