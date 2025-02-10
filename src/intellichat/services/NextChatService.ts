import Debug from 'debug';
import IChatReader, { ITool } from 'intellichat/readers/IChatReader';
import {
  IAnthropicTool,
  IChatContext,
  IChatRequestMessage,
  IChatRequestMessageContent,
  IChatRequestPayload,
  IGeminiChatRequestMessagePart,
  IGoogleTool,
  IMCPTool,
  IOpenAITool,
  IChatResponseMessage,
  IToolCall,
} from 'intellichat/types';
import { IServiceProvider } from 'providers/types';
import useSettingsStore from 'stores/useSettingsStore';
import { raiseError, stripHtmlTags } from 'utils/util';

const debug = Debug('5ire:intellichat:NextChatService');

export default abstract class NextCharService {
  abortController: AbortController;
  context: IChatContext;
  provider: IServiceProvider;
  modelMapping: Record<string, string>;
  apiSettings: {
    base: string;
    key: string;
    model: string;
    secret?: string; // baidu
    deploymentId?: string; // azure
  };
  protected abstract getReaderType(): new (
    reader: ReadableStreamDefaultReader<Uint8Array>
  ) => IChatReader;
  protected onCompleteCallback: (result: IChatResponseMessage) => Promise<void>;
  protected onReadingCallback: (chunk: string) => void;
  protected onToolCallsCallback: (toolName: string) => void;
  protected onErrorCallback: (error: any, aborted: boolean) => void;
  protected usedToolNames: string[] = [];
  protected inputTokens: number = 0;
  protected outputTokens: number = 0;
  protected toolCallsWithResponses: IToolCall[] = [];
  protected currentRecursionDepth: number = 0;
  protected readonly MAX_RECURSION_DEPTH = 10;

  constructor({
    context,
    provider,
  }: {
    context: IChatContext;
    provider: IServiceProvider;
  }) {
    this.apiSettings = useSettingsStore.getState().api;
    this.modelMapping = useSettingsStore.getState().modelMapping;
    this.provider = provider;
    this.context = context;
    this.abortController = new AbortController();

    this.onReadingCallback = (chunk: string) => {
      debug('Reading chunk:', chunk.substring(0, 100));
    };
    this.onToolCallsCallback = (toolName: string) => {
      debug('Tool called:', toolName);
    };
    this.onErrorCallback = (error: any, aborted: boolean) => {
      debug('Error occurred:', { error, aborted });
    };
    this.onCompleteCallback = async (result: IChatResponseMessage) => {
      debug('Starting onCompleteCallback:', {
        content: result.content?.substring(0, 100),
        hasToolCalls: !!result.toolCalls,
        toolCallsType: typeof result.toolCalls,
        toolCallsLength: result.toolCalls?.length,
        error: result.error
      });
      
      if (result.toolCalls) {
        debug('Processing toolCalls in response:', {
          count: result.toolCalls.length,
          names: result.toolCalls.map((tc: { name: string }) => tc.name),
          toolCallsType: typeof result.toolCalls,
          isArray: Array.isArray(result.toolCalls),
          fullData: JSON.stringify(result.toolCalls, null, 2)
        });
      }
      
      const messageId = this.context.getMessageId();
      if (!messageId) {
        debug('No message ID found, cannot update message');
        return;
      }
      
      const message = {
        id: messageId,
        reply: result.content || '',
        toolCalls: result.toolCalls || [],
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        isActive: result.toolCalls && result.toolCalls.length > 0 ? 1 : 0,
      };
      
      debug('Created message object:', {
        messageId: message.id,
        toolCalls: message.toolCalls,
        toolCallsType: typeof message.toolCalls,
        isArray: Array.isArray(message.toolCalls),
        isActive: message.isActive,
        replyLength: message.reply.length
      });
      
      await this.context.updateMessage(message);
      
      debug('Message updated:', {
        messageId: message.id,
        toolCalls: message.toolCalls,
        toolCallsType: typeof message.toolCalls,
        isActive: message.isActive
      });
    };
  }

  public onComplete(callback: (result: IChatResponseMessage) => Promise<void>) {
    this.onCompleteCallback = callback;
  }

  protected createReader(
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): IChatReader {
    const ReaderType = this.getReaderType();
    return new ReaderType(reader);
  }
  protected abstract makeToolMessages(
    tool: ITool,
    toolResult: any
  ): IChatRequestMessage[];
  protected abstract makeTool(
    tool: IMCPTool
  ): IOpenAITool | IAnthropicTool | IGoogleTool;
  protected abstract makePayload(
    messages: IChatRequestMessage[]
  ): Promise<IChatRequestPayload>;
  protected abstract makeRequest(
    messages: IChatRequestMessage[]
  ): Promise<Response>;

  protected getModelName() {
    const model = this.context.getModel();
    return this.modelMapping[model.name] || model.name;
  }

  public onReading(callback: (chunk: string) => void) {
    this.onReadingCallback = callback;
  }

  public onToolCalls(callback: (toolName: string) => void) {
    this.onToolCallsCallback = callback;
  }

  public onError(callback: (error: any, aborted: boolean) => void) {
    this.onErrorCallback = callback;
  }

  protected onReadingError(chunk: string) {
    try {
      const { error } = JSON.parse(chunk);
      console.error(error);
    } catch (err) {
      throw new Error(`Something went wrong`);
    }
  }

  protected async convertPromptContent(
    content: string
  ): Promise<
    | string
    | IChatRequestMessageContent[]
    | IChatRequestMessageContent[]
    | IGeminiChatRequestMessagePart[]
  > {
    return stripHtmlTags(content);
  }

  public abort() {
    this.abortController?.abort();
  }

  public isReady(): boolean {
    const { apiSchema } = this.provider.chat;
    if (apiSchema.includes('model') && !this.apiSettings.model) {
      return false;
    }
    if (apiSchema.includes('base') && !this.apiSettings.base) {
      return false;
    }
    if (apiSchema.includes('key') && !this.apiSettings.key) {
      return false;
    }
    return true;
  }

  public async chat(messages: IChatRequestMessage[]) {
    // Reset tool calls array and recursion depth if this is the top-level call
    if (this.currentRecursionDepth === 0) {
      this.toolCallsWithResponses = [];
    }
    
    // Check recursion depth
    if (this.currentRecursionDepth >= this.MAX_RECURSION_DEPTH) {
      debug('Maximum recursion depth reached:', {
        depth: this.currentRecursionDepth,
        maxDepth: this.MAX_RECURSION_DEPTH
      });
      await this.onCompleteCallback({
        content: 'Maximum recursion depth reached for tool calls.',
        toolCalls: this.toolCallsWithResponses,
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        error: {
          code: 500,
          message: `Maximum recursion depth (${this.MAX_RECURSION_DEPTH}) reached for tool calls.`,
        },
      });
      return;
    }

    this.currentRecursionDepth++;
    this.abortController = new AbortController();
    let reply = '';
    let signal = null;
    debug('Starting chat with messages:', messages);
    try {
      signal = this.abortController.signal;
      const response = await this.makeRequest(messages);
      debug('Start Reading:', response.status, response.statusText);
      if (response.status !== 200) {
        const contentType = response.headers.get('content-type');
        let msg, json;
        if (contentType?.includes('application/json')) {
          json = await response.json();
        } else {
          msg = await response.text();
        }
        raiseError(response.status, json, msg);
      }
      const reader = response.body?.getReader();
      if (!reader) {
        this.onErrorCallback(new Error('No reader'), false);
        return;
      }
      const chatReader = this.createReader(reader);
      const readResult = await chatReader.read({
        onError: (err: any) => this.onErrorCallback(err, false),
        onProgress: (chunk: string) => {
          reply += chunk;
          this.onReadingCallback(chunk);
        },
        onToolCalls: this.onToolCallsCallback,
      });
      debug('Read result:', {
        hasToolCalls: readResult.toolCalls && readResult.toolCalls.length > 0,
        hasTool: !!readResult.tool,
        toolCalls: readResult.toolCalls ? JSON.stringify(readResult.toolCalls, null, 2) : null,
        tool: readResult.tool ? JSON.stringify(readResult.tool, null, 2) : null
      });
      if (readResult?.inputTokens) {
        this.inputTokens += readResult.inputTokens;
      }
      if (readResult?.outputTokens) {
        this.outputTokens += readResult.outputTokens;
      }
      if (readResult.tool) {
        const [client, name] = readResult.tool.name.split('--');
        debug('Processing tool call:', {
          toolName: readResult.tool.name,
          client,
          name,
          args: readResult.tool.args,
          hasExistingToolCalls: this.toolCallsWithResponses.length > 0,
          existingToolCalls: JSON.stringify(this.toolCallsWithResponses, null, 2)
        });

        const toolCallsResult = await window.electron.mcp.callTool({
          client,
          name,
          args: readResult.tool.args,
        });

        debug('Tool call execution completed:', {
          toolName: readResult.tool.name,
          result: toolCallsResult,
          resultType: typeof toolCallsResult
        });

        const newToolCall = {
          name: readResult.tool.name,
          args: readResult.tool.args,
          response: toolCallsResult
        };

        debug('Created new tool call object:', {
          toolCall: newToolCall,
          toolCallJson: JSON.stringify(newToolCall, null, 2)
        });

        this.toolCallsWithResponses.push(newToolCall);

        debug('Updated toolCallsWithResponses array:', {
          toolCallsCount: this.toolCallsWithResponses.length,
          toolCalls: JSON.stringify(this.toolCallsWithResponses, null, 2),
          allToolCallsJson: JSON.stringify(this.toolCallsWithResponses.map(tc => ({
            name: tc.name,
            hasArgs: !!tc.args,
            hasResponse: !!tc.response
          })), null, 2)
        });

        const _messages = [
          ...messages,
          ...this.makeToolMessages(readResult.tool, toolCallsResult),
        ] as IChatRequestMessage[];

        debug('Recursively calling chat with updated messages:', {
          originalMessagesCount: messages.length,
          newMessagesCount: _messages.length,
          toolCallsWithResponsesCount: this.toolCallsWithResponses.length,
          currentRecursionDepth: this.currentRecursionDepth
        });

        await this.chat(_messages);
      } else {
        debug('No tool call in readResult, preparing final response:', {
          hasReply: !!reply,
          replyPreview: reply?.substring(0, 100),
          hasToolCalls: !!readResult.toolCalls,
          toolCallsCount: readResult.toolCalls?.length || 0,
          toolCallsWithResponsesCount: this.toolCallsWithResponses.length
        });

        if (readResult.toolCalls) {
          debug('Tool calls found in readResult:', {
            count: readResult.toolCalls.length,
            names: readResult.toolCalls.map((tc: { name: string }) => tc.name),
            toolCallsType: typeof readResult.toolCalls,
            isArray: Array.isArray(readResult.toolCalls),
            fullData: JSON.stringify(readResult.toolCalls, null, 2)
          });
        }

        const allToolCalls = [
          ...this.toolCallsWithResponses,
          ...(readResult.toolCalls || [])
        ];

        debug('Final combined tool calls:', {
          toolCallsWithResponsesCount: this.toolCallsWithResponses.length,
          toolCallsWithResponsesData: JSON.stringify(this.toolCallsWithResponses, null, 2),
          readResultToolCallsCount: readResult.toolCalls?.length || 0,
          readResultToolCallsData: readResult.toolCalls ? JSON.stringify(readResult.toolCalls, null, 2) : null,
          allToolCallsCount: allToolCalls.length,
          allToolCallsData: JSON.stringify(allToolCalls, null, 2),
          toolCallTypes: allToolCalls.map(tc => ({
            name: tc.name,
            type: typeof tc,
            hasArgs: !!tc.args,
            hasResponse: !!tc.response
          }))
        });

        await this.onCompleteCallback({
          content: reply,
          toolCalls: allToolCalls,
          inputTokens: this.inputTokens,
          outputTokens: this.outputTokens,
          error: readResult.error
        });

        this.inputTokens = 0;
        this.outputTokens = 0;
      }
    } catch (error: any) {
      this.onErrorCallback(error, !!signal?.aborted);
      debug('Error in chat:', {
        error,
        toolCallsWithResponses: JSON.stringify(this.toolCallsWithResponses, null, 2)
      });
      await this.onCompleteCallback({
        content: reply,
        toolCalls: this.toolCallsWithResponses,
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        error: {
          code: error.code || 500,
          message: error.message || error.toString(),
        },
      });
      this.inputTokens = 0;
      this.outputTokens = 0;
    } finally {
      this.currentRecursionDepth--;
    }
  }
}
