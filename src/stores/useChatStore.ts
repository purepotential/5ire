import Debug from 'debug';
import { create } from 'zustand';
import { typeid } from 'typeid-js';
import { produce } from 'immer';
import { isNil, isNumber, isString } from 'lodash';
import { NUM_CTX_MESSAGES, tempChatId } from 'consts';
import { captureException } from '../renderer/logging';
import { date2unix } from 'utils/util';
import { isBlank, isNotBlank } from 'utils/validators';
import useSettingsStore from './useSettingsStore';
import useStageStore from './useStageStore';
import { IChat, IChatMessage, IChatMessageInternal, IToolCall } from 'intellichat/types';
import { isValidTemperature } from 'intellichat/validators';
import { getProvider, getChatModel } from 'providers';

const debug = Debug('5ire:stores:useChatStore');

export interface IChatStore {
  chats: IChat[];
  chat: {
    id: string;
  } & Partial<IChat>;
  messages: IChatMessageInternal[];
  keywords: { [key: string]: string };
  states: {
    [key: string]: {
      loading: boolean;
      runningTool: string;
    };
  };
  updateStates: (
    chatId: string,
    states: { loading?: boolean; runningTool?: string | null }
  ) => void;
  getKeyword: (chatId: string) => string;
  setKeyword: (chatId: string, keyword: string) => void;
  // chat
  initChat: (chat: Partial<IChat>) => IChat;
  editChat: (chat: Partial<IChat>) => IChat;
  createChat: (
    chat: Partial<IChat>,
    beforeSetCallback?: (chat: IChat) => Promise<void>
  ) => Promise<IChat>;
  updateChat: (chat: { id: string } & Partial<IChat>) => Promise<boolean>;
  deleteChat: () => Promise<boolean>;
  fetchChat: (limit?: number) => Promise<IChat[]>;
  getChat: (id: string) => Promise<IChat>;
  // message
  createMessage: (message: Partial<IChatMessageInternal>) => Promise<IChatMessageInternal>;
  appendReply: (msgId: string, reply: string) => string;
  updateMessage: (
    message: { id: string } & Partial<IChatMessageInternal>
  ) => Promise<boolean>;
  bookmarkMessage: (id: string, bookmarkId: string | null) => void;
  deleteMessage: (id: string) => Promise<boolean>;
  getCurState: () => { loading: boolean; runningTool: string };
  fetchMessages: ({
    chatId,
    limit,
    offset,
    keyword,
  }: {
    chatId: string;
    limit?: number;
    offset?: number;
    keyword?: string;
  }) => Promise<IChatMessageInternal[]>;
}

const processMessage = (message: IChatMessage): IChatMessageInternal => {
  let toolCalls: IToolCall[] = [];
  
  // Early return if message is null/undefined
  if (!message) {
    debug('Received null/undefined message in processMessage');
    return {
      id: '',
      chatId: '',
      toolCalls: [],
      severity: 'info'
    } as IChatMessageInternal;
  }

  // Only process toolCalls if the field exists
  if (message.toolCalls !== undefined && message.toolCalls !== null) {
    try {
      debug('Processing message toolCalls:', {
        messageId: message.id,
        toolCallsType: typeof message.toolCalls
      });
      
      if (typeof message.toolCalls === 'string') {
        try {
          const parsed = JSON.parse(message.toolCalls);
          if (Array.isArray(parsed)) {
            toolCalls = parsed;
            debug('Successfully parsed toolCalls into array:', {
              messageId: message.id,
              toolCallsCount: toolCalls.length
            });
          } else {
            debug('Parsed toolCalls is not an array:', {
              messageId: message.id,
              parsed
            });
          }
        } catch (parseError) {
          debug('Failed to parse toolCalls string:', {
            messageId: message.id,
            error: parseError,
            toolCalls: message.toolCalls
          });
        }
      } else if (Array.isArray(message.toolCalls)) {
        toolCalls = message.toolCalls;
        debug('ToolCalls is already an array:', {
          messageId: message.id,
          toolCallsCount: toolCalls.length
        });
      } else {
        debug('ToolCalls is neither string nor array:', {
          messageId: message.id,
          toolCallsType: typeof message.toolCalls
        });
      }
    } catch (e) {
      debug('Error processing toolCalls:', {
        messageId: message.id,
        error: e,
        toolCalls: message.toolCalls
      });
    }
  } else {
    debug('No toolCalls field in message:', {
      messageId: message.id
    });
  }
  
  return {
    ...message,
    toolCalls  // Always an array (empty if parsing failed or field not present)
  };
};

const useChatStore = create<IChatStore>((set, get) => ({
  keywords: {},
  chats: [],
  chat: { id: tempChatId, model: '' },
  messages: [],
  states: {},
  stages: {},
  updateStates: (
    chatId: string,
    states: { loading?: boolean; runningTool?: string | null }
  ) => {
    set(
      produce((state: IChatStore) => {
        state.states[chatId] = Object.assign(
          state.states[chatId] || {},
          states
        );
      })
    );
  },
  getCurState: () => {
    const { chat, states } = get();
    return states[chat.id] || {};
  },
  getKeyword: (chatId: string) => {
    return get().keywords[chatId] || '';
  },
  setKeyword: (chatId: string, keyword: string) => {
    set(
      produce((state: IChatStore) => {
        state.keywords[chatId] = keyword;
      })
    );
  },
  initChat: (chat: Partial<IChat>) => {
    const { api } = useSettingsStore.getState();
    const { editStage } = useStageStore.getState();
    const $chat = {
      model: api.model,
      temperature: getProvider(api.provider).chat.temperature.default,
      maxTokens: null,
      maxCtxMessages: NUM_CTX_MESSAGES,
      ...chat,
      id: tempChatId,
    } as IChat;
    debug('Init a chat', $chat);
    set({ chat: $chat, messages: [] });
    return $chat;
  },
  editChat: (chat: Partial<IChat>) => {
    const { api } = useSettingsStore.getState();
    const $chat = get().chat as IChat;
    if (isString(chat.summary)) {
      $chat.summary = chat.summary as string;
    }
    if (isNotBlank(chat.model)) {
      $chat.model = chat.model as string;
    }
    if (!isNil(chat.systemMessage)) {
      $chat.systemMessage = chat.systemMessage as string;
    }
    if (isNumber(chat.maxCtxMessages) && chat.maxCtxMessages >= 0) {
      $chat.maxCtxMessages = chat.maxCtxMessages;
    }
    if (isValidTemperature(chat.temperature, api.provider)) {
      $chat.temperature = chat.temperature;
    }
    if (isNumber(chat.maxTokens) && chat.maxTokens > 0) {
      $chat.maxTokens = chat.maxTokens;
    }
    $chat.stream = isNil(chat.stream) ? true : chat.stream;
    set({ chat: { ...$chat } });
    return $chat;
  },
  createChat: async (
    chat: Partial<IChat>,
    beforeSetCallback?: (chat: IChat) => Promise<void>
  ) => {
    const $chat = {
      ...get().chat,
      ...chat,
      id: typeid('chat').toString(),
      createdAt: date2unix(new Date()),
    } as IChat;
    const { getPrompt, editStage } = useStageStore.getState();
    const stagePrompt = getPrompt(tempChatId);
    debug('Create a chat ', $chat);
    const ok = await window.electron.db.run(
      `INSERT INTO chats (id, summary, model, systemMessage, temperature, maxCtxMessages, maxTokens, stream, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        $chat.id,
        $chat.summary,
        $chat.model || null,
        $chat.systemMessage || null,
        $chat.temperature || null,
        $chat.maxCtxMessages || null,
        $chat.maxTokens || null,
        isNil($chat.stream) ? 1 : $chat.stream ? 1 : 0,
        $chat.createdAt,
      ]
    );
    if (!ok) {
      throw new Error('Write the chat into database failed');
    }
    if (beforeSetCallback) {
      await beforeSetCallback($chat);
    }
    set(
      produce((state: IChatStore) => {
        state.chat = $chat;
        state.chats = [$chat, ...state.chats];
        state.messages = [];
      })
    );
    /**
     * prompt 是通过 chatID 对应的，但 chat 一旦创建，id 就从 temp id 变成了 permanent id
     * 因此需要将 stage 的 prompt 转存到 permanent id 中
     */
    editStage($chat.id, { prompt: stagePrompt });
    return $chat;
  },
  updateChat: async (chat: { id: string } & Partial<IChat>) => {
    const $chat = { id: chat.id } as IChat;
    const stats: string[] = [];
    const params: (string | number)[] = [];
    if (isNotBlank(chat.summary)) {
      stats.push('summary = ?');
      $chat.summary = chat.summary as string;
      params.push($chat.summary);
    }
    if (isNotBlank(chat.model)) {
      stats.push('model = ?');
      $chat.model = chat.model as string;
      params.push($chat.model);
    }
    if (!isNil(chat.systemMessage)) {
      stats.push('systemMessage = ?');
      $chat.systemMessage = chat.systemMessage as string;
      params.push($chat.systemMessage);
    }
    if (isNumber(chat.maxCtxMessages) && chat.maxCtxMessages >= 0) {
      stats.push('maxCtxMessages = ?');
      $chat.maxCtxMessages = chat.maxCtxMessages;
      params.push($chat.maxCtxMessages);
    }
    if (isNumber(chat.temperature) && chat.temperature >= 0) {
      stats.push('temperature = ?');
      $chat.temperature = chat.temperature;
      params.push($chat.temperature);
    }
    if (isNumber(chat.maxTokens) && chat.maxTokens > 0) {
      stats.push('maxTokens = ?');
      $chat.maxTokens = chat.maxTokens;
      params.push($chat.maxTokens);
    }
    if (!isNil(chat.context)) {
      stats.push('context = ?');
      chat.context = chat.context as string;
      params.push(chat.context);
    }
    if (!isNil(chat.stream)) {
      stats.push('stream = ?');
      $chat.stream = chat.stream;
      params.push($chat.stream ? 1 : 0);
    }
    if ($chat.id && stats.length) {
      params.push($chat.id);
      await window.electron.db.run(
        `UPDATE chats SET ${stats.join(', ')} WHERE id = ?`,
        params
      );
      const updatedChat = { ...get().chat, ...$chat } as IChat;
      const updatedChats = get().chats.map((c: IChat) => {
        if (c.id === updatedChat.id) {
          return updatedChat;
        }
        return c;
      });
      set({ chat: updatedChat, chats: updatedChats });
      debug('Update chat ', updatedChat);
      return true;
    }
    return false;
  },
  getChat: async (id: string) => {
    const chat = (await window.electron.db.get(
      'SELECT id, summary, model, systemMessage, maxTokens, temperature, context, maxCtxMessages, stream, createdAt FROM chats where id = ?',
      id
    )) as IChat;
    debug('Get chat:', chat);
    set({ chat });
    return chat;
  },
  fetchChat: async (limit: number = 100, offset = 0) => {
    const chats = (await window.electron.db.all(
      'SELECT id, summary, createdAt FROM chats ORDER BY createdAt DESC limit ? offset ?',
      [limit, offset]
    )) as IChat[];
    set({ chats });
    return chats;
  },
  deleteChat: async () => {
    const { chat, initChat } = get();
    try {
      if (chat.id !== tempChatId) {
        await window.electron.db.run(`DELETE FROM chats WHERE id = ?`, [
          chat.id,
        ]);
        await window.electron.db.run(`DELETE FROM messages WHERE chatId = ?`, [
          chat.id,
        ]);
        set(
          produce((state: IChatStore) => {
            state.messages = [];
            const index = state.chats.findIndex((i) => i.id === chat.id);
            if (index > -1) {
              state.chats.splice(index, 1);
            }
          })
        );
        useStageStore.getState().deleteStage(chat.id);
      }
      initChat({});
      return true;
    } catch (err: any) {
      captureException(err);
      return false;
    }
  },
  createMessage: async (message: Partial<IChatMessageInternal>) => {
    debug('Creating message with toolCalls:', {
      messageId: message.id,
      hasToolCalls: !!message.toolCalls,
      toolCallsCount: message.toolCalls?.length || 0
    });

    const msgId = typeid('msg').toString();

    // Convert toolCalls to string for database storage
    const dbMessage = {
      ...message,
      id: msgId,
      toolCalls: message.toolCalls ? JSON.stringify(message.toolCalls) : '[]',
      createdAt: date2unix(new Date())
    } as IChatMessage;

    debug('Created message object for database:', {
      messageId: msgId,
      toolCalls: dbMessage.toolCalls,
      toolCallsType: typeof dbMessage.toolCalls
    });

    const columns = Object.keys(dbMessage);
    await window.electron.db.run(
      `INSERT INTO messages (${columns.join(',')})
      VALUES(${'?'.repeat(columns.length).split('').join(',')})`,
      Object.values(dbMessage)
    );
    
    const processedMsg = processMessage(dbMessage);
    debug('Processed message for state:', {
      messageId: processedMsg.id,
      toolCallsCount: processedMsg.toolCalls?.length || 0
    });

    const currentMessages = get().messages || [];
    set({ messages: [...currentMessages, processedMsg] });
    
    useStageStore
      .getState()
      .editStage(dbMessage.chatId, { chatId: dbMessage.chatId, input: '' });
    return processedMsg;
  },
  appendReply: (msgId: string, reply: string) => {
    let $reply = '';
    debug('Appending reply:', {
      messageId: msgId,
      replyLength: reply.length,
      replyPreview: reply.substring(0, 100)
    });
    set(
      produce((state: IChatStore) => {
        const message = state.messages.find((msg) => msg.id === msgId);
        if (message) {
          $reply = message.reply ? `${message.reply}${reply}` : reply;
          message.reply = $reply;
          debug('Updated message reply:', {
            messageId: msgId,
            totalLength: $reply.length,
            preview: $reply.substring(0, 100),
            toolCalls: message.toolCalls
          });
        } else {
          debug('Message not found for appending reply:', msgId);
        }
      })
    );
    return $reply;
  },
  updateMessage: async (message: { id: string } & Partial<IChatMessageInternal>) => {
    debug('Updating message:', {
      messageId: message.id,
      hasToolCalls: !!message.toolCalls,
      toolCallsCount: message.toolCalls?.length || 0
    });
    
    const msg = { id: message.id } as IChatMessage;
    const stats: string[] = [];
    const params: any[] = [];
    
    // Get current message from state
    const currentMessage = get().messages.find(m => m.id === message.id);
    
    if (!isNil(message.reply)) {
      stats.push('reply = ?');
      msg.reply = currentMessage?.reply || message.reply;
      params.push(msg.reply);
    }
    
    if (isNotBlank(message.prompt)) {
      stats.push('prompt = ?');
      msg.prompt = message.prompt;
      params.push(msg.prompt);
    }
    
    if (isNotBlank(message.model)) {
      stats.push('model = ?');
      msg.model = message.model;
      params.push(msg.model);
    }
    
    if (isNumber(message.temperature)) {
      stats.push('temperature = ?');
      msg.temperature = message.temperature;
      params.push(msg.temperature);
    }
    
    if (isNumber(message.inputTokens)) {
      stats.push('inputTokens = ?');
      msg.inputTokens = message.inputTokens;
      params.push(msg.inputTokens);
    }
    
    if (isNumber(message.outputTokens)) {
      stats.push('outputTokens = ?');
      msg.outputTokens = message.outputTokens;
      params.push(msg.outputTokens);
    }
    
    if (!isNil(message.memo)) {
      stats.push('memo = ?');
      msg.memo = message.memo;
      params.push(msg.memo);
    }

    // Handle tool calls - avoid double encoding
    if (!isNil(message.toolCalls)) {
      stats.push('toolCalls = ?');
      // Ensure we're storing a string in the database
      msg.toolCalls = Array.isArray(message.toolCalls) 
        ? JSON.stringify(message.toolCalls)
        : message.toolCalls;
      params.push(msg.toolCalls);
      debug('Updating toolCalls:', {
        messageId: message.id,
        toolCallsCount: Array.isArray(message.toolCalls) ? message.toolCalls.length : 0,
        toolCallsType: typeof message.toolCalls
      });
    }

    if (!isNil(message.isActive)) {
      // Determine if there are any tool calls (either from update or existing)
      const toolCalls = message.toolCalls || currentMessage?.toolCalls || [];
      const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;
      
      // Only set isActive to 0 if explicitly requested AND there are no tool calls
      const shouldBeActive = hasToolCalls || message.isActive === 1;
      
      stats.push('isActive = ?');
      msg.isActive = shouldBeActive ? 1 : 0;
      params.push(msg.isActive);
      
      debug('Updating isActive:', {
        messageId: message.id,
        hasToolCalls,
        requestedIsActive: message.isActive,
        finalIsActive: msg.isActive
      });
    }

    if (!isBlank(message.citedFiles)) {
      stats.push('citedFiles = ?');
      msg.citedFiles = message.citedFiles;
      params.push(msg.citedFiles);
    }

    if (!isBlank(message.citedChunks)) {
      stats.push('citedChunks = ?');
      msg.citedChunks = message.citedChunks;
      params.push(msg.citedChunks);
    }
    
    if (message.id && stats.length) {
      params.push(message.id);
      const result = await window.electron.db.run(
        `UPDATE messages SET ${stats.join(', ')} WHERE id = ?`,
        params
      );
      
      if (result) {
        set(
          produce((state: IChatStore) => {
            const index = state.messages.findIndex((m) => m.id === msg.id);
            if (index !== -1) {
              const currentMessage = state.messages[index];
              const updatedMessage = processMessage({
                ...currentMessage,
                ...msg,
              } as IChatMessage);
              state.messages[index] = updatedMessage;
              debug('Updated message in state:', {
                messageId: updatedMessage.id,
                toolCallsCount: updatedMessage.toolCalls?.length || 0
              });
            }
          })
        );
      }
      return result;
    }
    return false;
  },
  bookmarkMessage: (id: string, bookmarkId: string | null) => {
    const $messages = get().messages.map((msg) => {
      if (msg.id === id) {
        msg.bookmarkId = bookmarkId;
      }
      return msg;
    });
    set({ messages: [...$messages] });
  },
  deleteMessage: async (id: string) => {
    const ok = await window.electron.db.run(
      `DELETE FROM messages WHERE id = ?`,
      [id]
    );
    if (!ok) {
      throw new Error('Delete message failed');
    }
    const messages = [...get().messages];
    if (messages && messages.length) {
      const index = messages.findIndex((msg) => msg.id === id);
      if (index > -1) {
        debug(`remove msg(${id}) from index: ${index})`);
        messages.splice(index, 1);
        set({ messages: [...messages] });
      }
    }
    return true;
  },
  fetchMessages: async ({
    chatId,
    limit = 100,
    offset = 0,
    keyword = '',
  }: {
    chatId: string;
    limit?: number;
    offset?: number;
    keyword?: string;
  }) => {
    if (chatId === tempChatId) {
      debug('Fetching messages for temp chat, returning empty array');
      set({ messages: [] });
      return [];
    }

    // Validate and sanitize numeric parameters
    const sanitizedLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
    const sanitizedOffset = Math.max(0, Number(offset) || 0);

    let sql = `SELECT messages.*, bookmarks.id bookmarkId
    FROM messages
    LEFT JOIN bookmarks ON bookmarks.msgId = messages.id
    WHERE messages.chatId = ?`;
    let params: (string | number)[] = [chatId];

    if (keyword && keyword.trim() !== '') {
      const trimmedKeyword = keyword.trim();
      sql += ` AND (messages.prompt LIKE ? COLLATE NOCASE OR messages.reply LIKE ? COLLATE NOCASE)`;
      params.push(`%${trimmedKeyword}%`, `%${trimmedKeyword}%`);
    }

    sql += ' ORDER BY messages.createdAt ASC LIMIT ? OFFSET ?';
    params.push(sanitizedLimit, sanitizedOffset);

    debug('Fetching messages:', { sql, params });
    
    try {
      const messages = (await window.electron.db.all(sql, params)) as IChatMessage[];
      
      // Only process messages that have toolCalls
      const processedMessages = messages.map(msg => 
        msg.toolCalls ? processMessage(msg) : { ...msg, toolCalls: [] }
      );

      debug('Processed fetched messages:', {
        count: processedMessages.length,
        messages: processedMessages.map(m => ({
          id: m.id,
          toolCallsCount: m.toolCalls?.length || 0
        }))
      });

      set({ messages: processedMessages });
      return processedMessages;
    } catch (error) {
      debug('Error fetching messages:', error);
      // Return empty array on error to maintain consistent return type
      return [];
    }
  },
}));

export default useChatStore;
