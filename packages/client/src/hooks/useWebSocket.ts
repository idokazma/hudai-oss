import { useEffect } from 'react';
import { wsClient } from '../ws/ws-client.js';
import { useSessionStore } from '../stores/session-store.js';
import { useEventStore } from '../stores/event-store.js';
import { usePanesStore } from '../stores/panes-store.js';
import { usePaneContentStore } from '../stores/pane-content-store.js';
import { useGraphStore } from '../stores/graph-store.js';
import { usePlanStore } from '../stores/plan-store.js';
import { useNotificationStore } from '../stores/notification-store.js';
import { useReplayStore } from '../stores/replay-store.js';
import { useDocsStore } from '../stores/docs-store.js';
import { useConfigStore } from '../stores/config-store.js';
import { useAgentStore } from '../stores/agent-store.js';
import { useTokenStore } from '../stores/token-store.js';
import { useInsightStore } from '../stores/insight-store.js';
import { useLibraryStore } from '../stores/library-store.js';
import { useChatStore } from '../stores/chat-store.js';
import { usePreviewStore } from '../stores/preview-store.js';
import { useSwarmStore } from '../stores/swarm-store.js';

let chatNotifCounter = 0;
let lastChatActivity: string | null = null;
let lastChatActivityDetail: string | null = null;
const seenChatGroups = new Set<string>();

function handleActivityChat(
  activity: string | undefined,
  detail: string | undefined,
  options: string[] | undefined,
  sessionId: string,
) {
  if (!activity) return;
  const detailChanged = detail !== lastChatActivityDetail;
  const isWaitingState = activity === 'waiting_answer' || activity === 'waiting_permission';
  if (activity === lastChatActivity && !(isWaitingState && detailChanged)) return;

  lastChatActivity = activity;
  lastChatActivityDetail = detail ?? null;

  const chat = useChatStore.getState();

  switch (activity) {
    case 'working':
      // Resolve any outstanding actionable/respondable messages
      chat.messages
        .filter((m) => (m.actionable || m.respondable) && !m.resolved)
        .forEach((m) => chat.resolveMessage(m.id));
      break;

    case 'waiting_permission':
      chat.addMessage({
        id: `chat-notif-${++chatNotifCounter}`,
        sessionId,
        timestamp: Date.now(),
        role: 'system',
        text: detail || 'Permission requested — check terminal',
        actionable: true,
        notificationType: 'warning',
      });
      break;

    case 'waiting_answer':
      chat.addMessage({
        id: `chat-notif-${++chatNotifCounter}`,
        sessionId,
        timestamp: Date.now(),
        role: 'system',
        text: detail || 'Agent has a question',
        respondable: true,
        options,
        notificationType: 'warning',
      });
      break;

    case 'waiting_input': {
      // Deduplicate: don't add if the last system message is already an idle notification
      const lastSys = [...chat.messages].reverse().find((m) => m.role === 'system' && m.notificationType === 'info');
      const idleText = 'Agent finished — waiting for next command';
      if (lastSys?.text === idleText) break;
      chat.addMessage({
        id: `chat-notif-${++chatNotifCounter}`,
        sessionId,
        timestamp: Date.now(),
        role: 'system',
        text: idleText,
        notificationType: 'info',
      });
      break;
    }
  }
}

function generateChatNotification(_event: any) {
  // Chat is reserved for user ↔ advisor conversation and actionable prompts
  // (permission requests, questions). All other notifications are visible
  // in the timeline and status bar.
}

export function useWebSocket() {
  const setSession = useSessionStore((s) => s.setSession);
  const updateSessionFromEvent = useSessionStore((s) => s.updateFromEvent);
  const addEvent = useEventStore((s) => s.addEvent);
  const clearEvents = useEventStore((s) => s.clear);
  const setPanes = usePanesStore((s) => s.setPanes);
  const setPaneContent = usePaneContentStore((s) => s.setContent);
  const setGraph = useGraphStore((s) => s.setGraph);
  const applyGraphUpdates = useGraphStore((s) => s.applyUpdates);
  const addActivity = useGraphStore((s) => s.addActivity);
  const updatePlan = usePlanStore((s) => s.updateFromEvent);
  const clearPlan = usePlanStore((s) => s.clear);
  const handleActivityChange = useNotificationStore((s) => s.handleActivityChange);
  const clearNotifications = useNotificationStore((s) => s.clear);
  const setSessions = useReplayStore((s) => s.setSessions);
  const loadReplayEvents = useReplayStore((s) => s.loadEvents);

  useEffect(() => {
    wsClient.connect();

    const unsub = wsClient.onMessage((msg) => {
      const replayMode = useReplayStore.getState().mode;

      switch (msg.kind) {
        case 'session.state':
          // Only process live session state when not in replay mode
          if (replayMode === 'live') {
            if (msg.state.sessionId && msg.state.eventCount === 0) {
              clearEvents();
              clearPlan();
              clearNotifications();
              useInsightStore.getState().clear();
              // Reset chat notification state
              lastChatActivity = null;
              lastChatActivityDetail = null;
              seenChatGroups.clear();
              chatNotifCounter = 0;
              // Chat history persists across session switches for swarm awareness
              useGraphStore.getState().clearPipeline();
              useLibraryStore.getState().clear();
            }
            // Track which session the plan store should accept events from
            if (msg.state.sessionId) {
              usePlanStore.getState().setSessionId(msg.state.sessionId);
            }
            setSession(msg.state);
            // Detect agent activity transitions → update activity tracking + push chat messages
            handleActivityChange(msg.state.agentActivity, msg.state.agentActivityDetail, msg.state.agentActivityOptions);
            handleActivityChat(msg.state.agentActivity, msg.state.agentActivityDetail, msg.state.agentActivityOptions, msg.state.sessionId);
          }
          break;
        case 'event': {
          // Ignore live events during replay
          if (replayMode === 'replay') break;
          addEvent(msg.event);
          addActivity(msg.event);
          const totalEvents = useEventStore.getState().events.length;
          updateSessionFromEvent(msg.event, totalEvents);
          updatePlan(msg.event);
          generateChatNotification(msg.event);
          // Track sub-agent lifecycle
          if (msg.event.type === 'subagent.start') {
            useAgentStore.getState().addAgent((msg.event as any).data, msg.event.timestamp);
          } else if (msg.event.type === 'subagent.end') {
            useAgentStore.getState().removeAgent((msg.event as any).data.agentId);
          } else if (msg.event.agentId) {
            useAgentStore.getState().incrementEventCount(msg.event.agentId);
          }
          break;
        }
        case 'replay.events':
          // In replay mode, load into replay store
          if (replayMode === 'replay') {
            loadReplayEvents(msg.events);
          } else {
            // Live mode: bulk-load historical events with full side-effects
            // Clear first to avoid duplicates on reconnect
            clearEvents();
            // Preserve sessionId across plan clear so session filtering works during replay
            const planSessionId = usePlanStore.getState().sessionId;
            clearPlan();
            if (planSessionId) usePlanStore.getState().setSessionId(planSessionId);
            const eventStore = useEventStore.getState();
            eventStore.addEvents(msg.events);
            // Replay side-effects for each event (graph activity, plans)
            for (const ev of msg.events) {
              addActivity(ev);
              updatePlan(ev);
            }
            // Update session event count from bulk load
            if (msg.events.length > 0) {
              const lastEvent = msg.events[msg.events.length - 1];
              updateSessionFromEvent(lastEvent, msg.events.length);
            }
            // If agent is idle after replaying history, mark active tasks as done
            // (they completed before we reconnected)
            const currentActivity = useSessionStore.getState().session.agentActivity;
            if (currentActivity === 'waiting_input' || !currentActivity) {
              usePlanStore.getState().markAllDone();
            }
          }
          break;
        case 'sessions.list':
          setSessions(msg.sessions);
          break;
        case 'panes.list':
          setPanes(msg.panes);
          break;
        case 'pane.content':
          if (replayMode === 'live') {
            setPaneContent(msg.content, msg.caret);
          }
          break;
        case 'graph.full':
          setGraph(msg.graph);
          break;
        case 'graph.update':
          if (replayMode === 'live') {
            applyGraphUpdates(msg.updates);
          }
          break;
        case 'file.content':
          useDocsStore.getState().setContent(msg.path, msg.content, msg.error);
          break;
        case 'file.write.result':
          useDocsStore.getState().setWriteResult(msg.path, msg.success, msg.error);
          break;
        case 'config.full':
          useConfigStore.getState().setConfig(msg.config);
          break;
        case 'tokens.state':
          useTokenStore.getState().setState(msg.state);
          break;
        case 'permission.suggestion':
          useConfigStore.getState().addSuggestion(msg.suggestion);
          break;
        case 'pipeline.full':
          useGraphStore.getState().setPipelineLayer(msg.layer);
          break;
        case 'pipeline.update':
          useGraphStore.getState().updatePipeline(msg.updates);
          break;
        case 'pipeline.analyzing':
          useGraphStore.getState().setPipelineAnalyzing(msg.status === 'started');
          break;
        case 'insight.summary':
          useInsightStore.getState().setSummary(msg.summary);
          // Also show in chat
          useChatStore.getState().addMessage({
            id: `summary-${msg.summary.generatedAt}`,
            sessionId: '',
            timestamp: msg.summary.generatedAt,
            role: 'advisor',
            text: msg.summary.text,
          });
          break;
        case 'insight.intent':
          useInsightStore.getState().setIntent(msg.intent);
          break;
        case 'insight.notification':
          useInsightStore.getState().addNotification(msg.notification);
          break;
        case 'library.clear':
          useLibraryStore.getState().clear();
          break;
        case 'library.progress':
          useLibraryStore.getState().setProgress(msg.progress);
          break;
        case 'library.ready':
          useLibraryStore.getState().setReady(msg.overview, msg.moduleCount, msg.fileCardCount);
          break;
        case 'library.manifest':
          useLibraryStore.getState().setManifest(msg.overview, msg.modules);
          break;
        case 'chat.message':
          useChatStore.getState().addMessage(msg.message);
          break;
        case 'chat.history':
          useChatStore.getState().setMessages(msg.messages);
          break;
        case 'chat.typing':
          useChatStore.getState().setTyping(msg.typing);
          break;
        case 'settings.advisor':
          useChatStore.getState().setVerbosity(msg.verbosity);
          break;
        case 'settings.advisorScope':
          useChatStore.getState().setScope(msg.scope);
          break;
        case 'plans.list':
          usePlanStore.getState().setAvailablePlans(msg.plans);
          break;
        case 'preview.ready':
          usePreviewStore.getState().setProxyPort(msg.proxyPort);
          break;
        case 'preview.error':
          console.error('[preview]', msg.error);
          break;
        case 'swarm.status':
          useSwarmStore.getState().setSessions(msg.sessions);
          break;
        case 'error':
          console.error('[server]', msg.message);
          break;
      }
    });

    return () => {
      unsub();
      wsClient.disconnect();
    };
  }, [setSession, addEvent, clearEvents, setPanes, setPaneContent, setGraph, applyGraphUpdates, addActivity, updateSessionFromEvent, updatePlan, clearPlan, handleActivityChange, clearNotifications, setSessions, loadReplayEvents]);
}
