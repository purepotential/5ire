import Debug from 'debug';
import { Text, Card, CardHeader, Accordion, AccordionItem, AccordionHeader, AccordionPanel } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { Code20Regular, ChevronDown20Regular } from '@fluentui/react-icons';
import { IToolCall } from 'intellichat/types';

const debug = Debug('5ire:pages:chat:ToolCallDisplay');

interface ToolCallDisplayProps {
  toolCalls: IToolCall[];
}

export default function ToolCallDisplay({ toolCalls }: ToolCallDisplayProps) {
  const { t } = useTranslation();

  debug('ToolCallDisplay received props:', {
    toolCallsLength: toolCalls?.length,
    toolCalls: JSON.stringify(toolCalls, null, 2)
  });

  // Ensure toolCalls is a valid array
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    debug('No valid tool calls to display, returning null');
    return null;
  }

  // Filter out invalid tool calls
  const validToolCalls = toolCalls.filter(tc => 
    tc && typeof tc === 'object' && 
    typeof tc.name === 'string' && 
    tc.name.trim() !== ''
  );

  if (validToolCalls.length === 0) {
    debug('No valid tool calls after filtering, returning null');
    return null;
  }

  debug('Rendering ToolCallDisplay with accordion items:', {
    toolCallsCount: validToolCalls.length,
    toolCallNames: validToolCalls.map(tc => tc.name)
  });

  return (
    <div className="tool-calls mt-4">
      <Accordion collapsible defaultOpenItems={[]}>
        {validToolCalls.map((toolCall, index) => {
          debug('Rendering accordion item:', {
            index,
            toolCallName: toolCall.name,
            hasResponse: !!toolCall.response,
            args: JSON.stringify(toolCall.args, null, 2),
            response: toolCall.response ? 
              (typeof toolCall.response === 'string' ? 
                toolCall.response.substring(0, 100) : 
                JSON.stringify(toolCall.response, null, 2)
              ) : null
          });
          return (
            <AccordionItem value={`${index}`} key={index}>
              <AccordionHeader
                expandIconPosition="end"
                expandIcon={<ChevronDown20Regular />}
              >
                <div className="flex items-center">
                  <Code20Regular className="mr-2" />
                  <Text weight="semibold">
                    {t('Common.Tool Call')}: {toolCall.name}
                  </Text>
                </div>
              </AccordionHeader>
              <AccordionPanel>
                <div className="space-y-4">
                  <div>
                    <Text weight="medium" className="text-sm mb-1 block">Query:</Text>
                    <pre className="text-sm bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-x-auto">
                      {JSON.stringify(toolCall.args, null, 2)}
                    </pre>
                  </div>
                  {toolCall.response && (
                    <div>
                      <Text weight="medium" className="text-sm mb-1 block">Response:</Text>
                      <pre className="text-sm bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-x-auto">
                        {typeof toolCall.response === 'string' 
                          ? toolCall.response 
                          : JSON.stringify(toolCall.response, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </AccordionPanel>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
} 