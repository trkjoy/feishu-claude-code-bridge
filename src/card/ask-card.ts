import type { AskOption } from '../ask/store';

const BRIDGE_ASK_MARKER = '__bridge_ask';

export interface AskCardInput {
  askId: string;
  question: string;
  options: AskOption[];
}

export function askCard(input: AskCardInput): object {
  return {
    schema: '2.0',
    config: {
      summary: {
        content: clipSummary(input.question),
      },
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: `**需要你确认**\n\n${input.question}\n\n_点击一个选项后，当前任务会继续执行。_`,
        },
        { tag: 'hr' },
        {
          tag: 'column_set',
          flex_mode: 'flow',
          horizontal_spacing: 'small',
          columns: input.options.map((option) => ({
            tag: 'column',
            width: 'auto',
            elements: [
              {
                tag: 'button',
                text: { tag: 'plain_text', content: option.label },
                type: option.style ?? 'default',
                behaviors: [
                  {
                    type: 'callback',
                    value: {
                      [BRIDGE_ASK_MARKER]: true,
                      ask_id: input.askId,
                      option_value: option.value,
                      option_label: option.label,
                    },
                  },
                ],
              },
            ],
          })),
        },
      ],
    },
  };
}

function clipSummary(question: string): string {
  const trimmed = question.trim();
  if (!trimmed) return '需要确认';
  return trimmed.length > 30 ? `${trimmed.slice(0, 30)}…` : trimmed;
}
