/* eslint-disable jsx-a11y/anchor-has-content */
/* eslint-disable react/no-danger */
import Debug from 'debug';
import useChatStore from 'stores/useChatStore';
import { useCallback, useEffect, useMemo } from 'react';
import useMarkdown from 'hooks/useMarkdown';
import MessageToolbar from './MessageToolbar';
import ToolCallDisplay from './ToolCallDisplay';
import {highlight } from '../../../utils/util';
import { IChatMessageInternal } from 'intellichat/types';
import { useTranslation } from 'react-i18next';
import { Divider } from '@fluentui/react-components';
import useKnowledgeStore from 'stores/useKnowledgeStore';
import useToast from 'hooks/useToast';
import ToolSpinner from 'renderer/components/ToolSpinner';
import useSettingsStore from 'stores/useSettingsStore';

const debug = Debug('5ire:pages:chat:Message');

export default function Message({ message }: { message: IChatMessageInternal }) {
  const { t } = useTranslation();
  const { notifyInfo } = useToast();
  const fontSize = useSettingsStore((state) => state.fontSize);
  const keywords = useChatStore((state: any) => state.keywords);
  const states = useChatStore().getCurState();
  const { showCitation } = useKnowledgeStore();
  
  debug('Message component received props:', {
    messageId: message.id,
    hasToolCalls: !!message.toolCalls,
    toolCallsCount: message.toolCalls?.length || 0,
    isActive: message.isActive,
    reply: message.reply?.substring(0, 100)
  });

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

  const toolCalls = useMemo(() => {
    debug('Processing toolCalls:', {
      messageId: message.id,
      toolCallsType: typeof message.toolCalls,
      rawValue: message.toolCalls
    });

    if (!message.toolCalls) return [];
    
    // Handle string format (from database)
    if (typeof message.toolCalls === 'string') {
      try {
        const parsed = JSON.parse(message.toolCalls);
        debug('Parsed toolCalls from string:', {
          messageId: message.id,
          parsedType: typeof parsed,
          parsedLength: Array.isArray(parsed) ? parsed.length : 0
        });
        return parsed;
      } catch (e) {
        debug('Failed to parse toolCalls:', e);
        return [];
      }
    }
    
    // Handle array format (from live updates)
    if (Array.isArray(message.toolCalls)) {
      debug('Processing array toolCalls:', {
        messageId: message.id,
        arrayLength: message.toolCalls.length
      });
      return message.toolCalls;
    }
    
    return [];
  }, [message.toolCalls, message.id]);

  useEffect(() => {
    debug('Tool calls render check:', {
      messageId: message.id,
      hasToolCalls: toolCalls.length > 0,
      toolCallsCount: toolCalls.length,
      isActive: message.isActive
    });
  }, [message.id, toolCalls, message.isActive]);

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

  const replyNode = useCallback(() => {
    debug('Rendering reply node:', {
      messageId: message.id,
      isActive: message.isActive,
      loading: states.loading,
      reply: message.reply?.substring(0, 100),
      runningTool: states.runningTool,
      hasToolCalls: toolCalls.length > 0,
      toolCallsCount: toolCalls.length,
      toolCalls: message.toolCalls
    });
    
    if (message.isActive && states.loading) {
      if (!message.reply || message.reply === '') {
        return (
          <div className="w-full mt-1.5">
            {states.runningTool && (
              <div className="flex flex-row justify-start items-center gap-1">
                <ToolSpinner size={20} style={{ marginBottom: '-3px' }} />
                <span>{states.runningTool}</span>
              </div>
            )}
            <span className="skeleton-box" style={{ width: '80%' }} />
            <span className="skeleton-box" style={{ width: '90%' }} />
          </div>
        );
      }
      return (
        <div
          className={`mt-1 break-all ${
            fontSize === 'large' ? 'font-lg' : ''
          }`}
          dangerouslySetInnerHTML={{
            __html: render(
              `${
                highlight(message.reply || '', keyword || '') || ''
              }<span class="blinking-cursor" /></span>`
            ),
          }}
        />
      );
    }
    return (
      <div
        className={`mt-1 break-all ${fontSize === 'large' ? 'font-lg' : ''}`}
        dangerouslySetInnerHTML={{
          __html: render(highlight(message.reply || '', keyword || '') || ''),
        }}
      />
    );
  }, [message, keyword, states, fontSize]);

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
              __html: render(highlight(message.prompt, keyword) || ''),
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
            {toolCalls.length > 0 && (
              (() => {
                debug('Rendering ToolCallDisplay:', {
                  messageId: message.id,
                  toolCallsCount: toolCalls.length
                });
                return <ToolCallDisplay toolCalls={toolCalls} />;
              })()
            )}
          </div>
        </div>
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
  );
}
