/* eslint-disable jsx-a11y/anchor-has-content */
/* eslint-disable react/no-danger */
import Debug from 'debug';
import useChatStore from 'stores/useChatStore';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import useMarkdown from 'hooks/useMarkdown';
import MessageToolbar from './MessageToolbar';
import ToolCallDisplay from './ToolCallDisplay';
import {highlight } from '../../../utils/util';
import { IChatMessageInternal, IToolCall } from 'intellichat/types';
import { useTranslation } from 'react-i18next';
import { Divider } from '@fluentui/react-components';
import useKnowledgeStore from 'stores/useKnowledgeStore';
import useToast from 'hooks/useToast';
import ToolSpinner from 'renderer/components/ToolSpinner';
import useSettingsStore from 'stores/useSettingsStore';

const debug = Debug('5ire:pages:chat:Message');

interface MessageSegment {
  type: 'text' | 'tool' | 'running-tool';
  content: string | IToolCall;
}

export default function Message({ message }: { message: IChatMessageInternal }) {
  const { t } = useTranslation();
  const { notifyInfo } = useToast();
  const fontSize = useSettingsStore((state) => state.fontSize);
  const keywords = useChatStore((state: any) => state.keywords);
  const states = useChatStore().getCurState();
  const { showCitation } = useKnowledgeStore();
  
  // Use refs to track latest message state and tool calls
  const messageRef = useRef<IChatMessageInternal>(message);
  const toolCallsRef = useRef<IToolCall[]>([]);
  const isProcessingRef = useRef(false);
  
  debug('Message component received props:', {
    messageId: message.id,
    hasToolCalls: !!message.toolCalls,
    toolCallsCount: message.toolCalls?.length || 0,
    isActive: message.isActive,
    reply: message.reply?.substring(0, 100)
  });

  // Update message ref when prop changes
  useEffect(() => {
    messageRef.current = message;
  }, [message]);

  const keyword = useMemo(
    () => keywords[message.chatId],
    [keywords, message.chatId]
  );
  const citedFiles = useMemo(
    () => JSON.parse(message.citedFiles || '[]'),
    [message.citedFiles]
  );

  const citedChunks = useMemo(() => {
    return JSON.parse(message.citedChunks || '[]');
  }, [message.citedChunks]);

  const { render } = useMarkdown();

  // Improved toolCalls parsing with error handling and validation
  const parseToolCalls = useCallback((rawToolCalls: string | IToolCall[] | undefined): IToolCall[] => {
    if (!rawToolCalls) return [];
    
    try {
      if (typeof rawToolCalls === 'string') {
        const parsed = JSON.parse(rawToolCalls);
        if (!Array.isArray(parsed)) {
          debug('Parsed toolCalls is not an array:', parsed);
          return [];
        }
        return parsed;
      }
      
      if (Array.isArray(rawToolCalls)) {
        return rawToolCalls;
      }
      
      debug('Invalid toolCalls format:', rawToolCalls);
      return [];
    } catch (e) {
      debug('Error parsing toolCalls:', e);
      return [];
    }
  }, []);

  const toolCalls = useMemo(() => {
    const parsed = parseToolCalls(message.toolCalls);
    toolCallsRef.current = parsed;
    return parsed;
  }, [message.toolCalls, parseToolCalls]);

  useEffect(() => {
    debug('Tool calls render check:', {
      messageId: message.id,
      hasToolCalls: toolCalls.length > 0,
      toolCallsCount: toolCalls.length,
      isActive: message.isActive
    });
  }, [message.id, toolCalls, message.isActive]);

  // Improved tool call update handler with chunked response support
  useEffect(() => {
    const updateMessage = useChatStore.getState().updateMessage;
    
    const unsubscribe = window.electron.ipcRenderer.on(
      'store:toolCallAppended',
      async (eventData: unknown) => {
        // Prevent concurrent processing of tool call updates
        if (isProcessingRef.current) {
          debug('Already processing a tool call update, deferring...');
          return;
        }
        
        try {
          isProcessingRef.current = true;
          debug('Received tool call event:', eventData);
          
          if (!eventData || typeof eventData !== 'object') {
            debug('Invalid event data received:', eventData);
            return;
          }

          const { data } = eventData as { data: { messageId: string; toolCall: IToolCall } };
          if (!data?.messageId || !data?.toolCall) {
            debug('Missing required data:', data);
            return;
          }

          const { messageId, toolCall } = data;
          if (messageId !== messageRef.current.id) {
            return;
          }

          debug('Processing tool call update:', {
            messageId,
            toolCall: JSON.stringify(toolCall, null, 2)
          });

          // Get latest message state
          const currentMessage = useChatStore.getState().messages.find(m => m.id === messageId);
          if (!currentMessage) {
            debug('Message not found:', messageId);
            return;
          }

          // Get current tool calls with validation
          const currentToolCalls = parseToolCalls(currentMessage.toolCalls);
          
          // Check for duplicate tool calls
          const isDuplicate = currentToolCalls.some(tc => 
            (tc as any).id === (toolCall as any).id || 
            (tc.position === toolCall.position && tc.name === toolCall.name)
          );

          if (isDuplicate) {
            debug('Duplicate tool call detected, skipping update:', toolCall);
            return;
          }

          // Add new tool call
          const updatedToolCalls = [...currentToolCalls, toolCall];
          
          // Sort by position to maintain order
          updatedToolCalls.sort((a, b) => (a.position || 0) - (b.position || 0));
          
          // Update message state
          await updateMessage({
            id: messageId,
            toolCalls: updatedToolCalls
          });

          toolCallsRef.current = updatedToolCalls;

          debug('Updated message with new tool calls:', {
            messageId,
            totalToolCalls: updatedToolCalls.length
          });
        } finally {
          isProcessingRef.current = false;
        }
      }
    );

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [message.id, parseToolCalls]);

  const onCitationClick = useCallback(
    (event: any) => {
      const url = new URL(event.target?.href);
      if (url.pathname === '/citation' || url.protocol.startsWith('file:')) {
        event.preventDefault();
        const chunkId = url.hash.replace('#', '');
        const chunk = citedChunks.find((chunk: any) => chunk.id === chunkId);
        if (chunk) {
          showCitation(chunk.content);
        } else {
          notifyInfo(t('Knowledge.Notification.CitationNotFound'));
        }
      }
    },
    [citedChunks, showCitation]
  );

  const registerCitationClick = useCallback(() => {
    const links = document.querySelectorAll('.msg-reply a');
    links.forEach((link) => {
      link.addEventListener('click', onCitationClick);
    });
  }, [onCitationClick]);

  useEffect(() => {
    registerCitationClick();
    return () => {
      const links = document.querySelectorAll('.msg-reply a');
      links.forEach((link) => {
        link.removeEventListener('click', onCitationClick);
      });
    };
  }, [message.isActive, registerCitationClick]);

  const renderMessageContent = useCallback(() => {
    if (!message.reply) return [] as MessageSegment[];
    
    debug('Rendering message content:', {
      messageId: message.id,
      reply: message.reply.substring(0, 100),
      toolCallsCount: toolCalls.length,
      runningTool: states.runningTool,
      isActive: message.isActive
    });
    
    // Filter and sort tool calls, properly handling position 0
    const sortedToolCalls = toolCalls
      .filter((tc: IToolCall) => tc.position !== undefined && tc.position !== null)
      .sort((a: IToolCall, b: IToolCall) => {
        const posA = a.position ?? Number.MAX_SAFE_INTEGER;
        const posB = b.position ?? Number.MAX_SAFE_INTEGER;
        return posA - posB;
      });

    debug('Sorted tool calls:', {
      count: sortedToolCalls.length,
      positions: sortedToolCalls.map((tc: IToolCall) => tc.position)
    });

    // Split message into segments based on tool call positions
    const segments: MessageSegment[] = [];
    let lastPosition = 0;
    const reply = message.reply || '';

    // Process all completed tool calls first
    sortedToolCalls.forEach((toolCall: IToolCall) => {
      const position = toolCall.position ?? 0;

      // Add text segment before tool call if there is any
      if (position > lastPosition) {
        segments.push({
          type: 'text',
          content: reply.substring(lastPosition, position)
        });
      } else if (position < lastPosition) {
        // Log warning for overlapping/out-of-order positions
        debug('Warning: Tool call positions may be overlapping or out of order:', {
          currentPosition: position,
          lastPosition,
          toolCall
        });
      }
      
      // Add completed tool call
      segments.push({
        type: 'tool',
        content: toolCall
      });
      lastPosition = position;
    });

    // Add any remaining text after the last tool call
    if (lastPosition < reply.length) {
      segments.push({
        type: 'text',
        content: reply.substring(lastPosition)
      });
    }

    // Add running tool if we're active and there's no completed tool call at the current position
    const hasCompletedToolAtCurrentPosition = sortedToolCalls.some(
      (tc: IToolCall) => tc.position === lastPosition
    );

    if (states.runningTool && message.isActive && !hasCompletedToolAtCurrentPosition) {
      debug('Adding running tool at position:', {
        position: lastPosition,
        runningTool: states.runningTool
      });
      
      segments.push({
        type: 'running-tool',
        content: states.runningTool
      });
    }

    debug('Final message segments:', {
      count: segments.length,
      types: segments.map(s => s.type),
      hasRunningTool: segments.some(s => s.type === 'running-tool')
    });

    return segments;
  }, [message.id, message.reply, toolCalls, states.runningTool, message.isActive]);

  const replyNode = useCallback(() => {
    debug('Rendering reply node:', {
      messageId: message.id,
      isActive: message.isActive,
      loading: states.loading,
      reply: message.reply?.substring(0, 100),
      runningTool: states.runningTool,
      hasToolCalls: toolCalls.length > 0,
      toolCallsCount: toolCalls.length
    });
    
    if (message.isActive && states.loading) {
      if (!message.reply && !states.runningTool) {
        return (
          <div className="w-full mt-1.5">
            <span className="skeleton-box" style={{ width: '80%' }} />
            <span className="skeleton-box" style={{ width: '90%' }} />
          </div>
        );
      }
    }

    const segments = renderMessageContent();
    
    return (
      <div className={`mt-1 break-all ${fontSize === 'large' ? 'font-lg' : ''}`}>
        {segments.map((segment: MessageSegment, index) => {
          const searchKeyword = keyword?.toString() || '';
          return (
            <div key={index}>
              {segment.type === 'text' ? (
                <div dangerouslySetInnerHTML={{
                  __html: render(highlight(segment.content as string, searchKeyword) || '')
                }} />
              ) : segment.type === 'running-tool' ? (
                <div className="flex flex-row justify-start items-center gap-1 my-2">
                  <ToolSpinner size={20} style={{ marginBottom: '-3px' }} />
                  <span>{segment.content as string}</span>
                </div>
              ) : (
                <ToolCallDisplay toolCalls={[segment.content as IToolCall]} />
              )}
            </div>
          );
        })}
        {message.isActive && states.loading && !states.runningTool && !toolCalls.length && (
          <span className="blinking-cursor" />
        )}
      </div>
    );
  }, [message.isActive, states.loading, states.runningTool, message.reply, 
      fontSize, render, highlight, keyword, renderMessageContent, toolCalls.length]);

  return (
    <div className="leading-6 message" id={message.id}>
      <div>
        <a
          id={`prompt-${message.id}`}
          aria-label={`prompt of message ${message.id}`}
        />

        <div
          className="msg-prompt my-2 flex flex-start"
          style={{ minHeight: '40px' }}
        >
          <div className="avatar flex-shrink-0 mr-2" />
          <div
            className={`mt-1 break-all ${
              fontSize === 'large' ? 'font-lg' : ''
            }`}
            dangerouslySetInnerHTML={{
              __html: render(highlight(message.prompt || '', keyword || '') || ''),
            }}
          />
        </div>
      </div>
      <div>
        <a id={`#reply-${message.id}`} aria-label={`Reply ${message.id}`} />
        <div
          className="msg-reply mt-2 flex flex-start"
          style={{ minHeight: '40px' }}
        >
          <div className="avatar flex-shrink-0 mr-2" />
          <div className="flex-grow">
            {replyNode()}
            {citedFiles.length > 0 && (
              <div className="message-cited-files mt-2">
                <div className="mt-4 mb-2">
                  <Divider>{t('Common.References')}</Divider>
                </div>
                <ul>
                  {citedFiles.map((file: string) => (
                    <li className="text-gray-500" key={file}>
                      {file}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <MessageToolbar message={message} />
          </div>
        </div>
      </div>
    </div>
  );
}
