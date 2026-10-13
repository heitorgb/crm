import { useState } from 'react';
import { Smile } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface EmojiCategory {
  id: string;
  label: string;
  icon: string;
  emojis: string[];
}

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    label: 'Carinhas',
    icon: '😀',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '🫠', '😉', '😊', '😇', '🥰',
      '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭',
      '🫢', '🫣', '🤫', '🤔', '🫡', '🤐', '🤨', '😐', '😑', '😶', '🫥', '😏', '😒', '🙄', '😬',
      '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴',
      '😵', '🤯', '🤠', '🥳', '🥸', '😎', '🤓', '🧐', '😕', '🫤', '😟', '🙁', '☹️', '😮', '😯',
      '😲', '😳', '🥺', '🥹', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞',
      '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '💩', '🤡', '👻', '👽',
      '🤖', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾',
    ],
  },
  {
    id: 'gestures',
    label: 'Gestos',
    icon: '👍',
    emojis: [
      '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👈',
      '👉', '👆', '👇', '☝️', '🫵', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🫶', '👐',
      '🤲', '🤝', '🙏', '✍️', '💅', '💪', '🦾', '🦵', '🦶', '👂', '👃', '🧠', '🫀', '🫁', '🦷',
      '🦴', '👀', '👁️', '👅', '👄', '🫦',
    ],
  },
  {
    id: 'hearts',
    label: 'Corações',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗',
      '💖', '💘', '💝', '💟', '♥️', '💯', '💢', '💥', '💫', '💦', '💨', '💬', '💭', '🗯️', '💤',
    ],
  },
  {
    id: 'objects',
    label: 'Objetos',
    icon: '📎',
    emojis: [
      '⌚', '📱', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '💽', '💾', '💿', '📷', '📸', '📹', '🎥', '📽️',
      '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '⏱️', '⏲️', '⏰', '🕰️', '⌛', '⏳', '📡', '🔋',
      '🔌', '💡', '🔦', '🕯️', '🧯', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '🧾', '💎',
      '⚖️', '🧰', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🔩', '⚙️', '🧱', '⛓️', '🧲', '🔫', '💣', '🧨',
      '🪓', '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️', '🪦', '⚱️', '🏺', '📦', '📫', '📮', '📝', '✏️',
      '🖊️', '🖋️', '🖌️', '🖍️', '📁', '📂', '📅', '📆', '📇', '📈', '📉', '📊', '📋', '📌', '📍',
      '📎', '🖇️', '📏', '📐', '✂️', '🗃️', '🗄️', '🗑️', '🔒', '🔓', '🔏', '🔐', '🔑', '🗝️', '🔗',
    ],
  },
  {
    id: 'food',
    label: 'Comidas',
    icon: '🍔',
    emojis: [
      '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍',
      '🥥', '🥝', '🍅', '🥑', '🥦', '🥬', '🥒', '🌶️', '🌽', '🥕', '🧄', '🧅', '🥔', '🥐', '🍞',
      '🥖', '🥨', '🧀', '🥚', '🍳', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🌭', '🍔', '🍟', '🍕',
      '🥪', '🥙', '🌮', '🌯', '🥗', '🥘', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🍤', '🍙',
      '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮',
      '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '☕', '🍵', '🥤', '🧋', '🍺', '🍻', '🥂',
      '🍷', '🥃', '🍸', '🍹', '🍾', '🍽️', '🍴', '🥄',
    ],
  },
  {
    id: 'nature',
    label: 'Natureza',
    icon: '🐶',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵',
      '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗',
      '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🕷️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕',
      '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆',
      '🦓', '🦍', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏',
      '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🐈', '🐓', '🦃', '🦚', '🦜', '🦢', '🦩', '🕊️', '🐇',
      '🦝', '🦨', '🦡', '🦦', '🦥', '🐁', '🐀', '🦔', '🌵', '🎄', '🌲', '🌳', '🌴', '🌱', '🌿',
      '☘️', '🍀', '🍃', '🍂', '🍁', '🍄', '🌾', '💐', '🌷', '🌹', '🥀', '🌺', '🌸', '🌼', '🌻',
      '🌞', '🌝', '🌚', '🌕', '🌙', '🌎', '🌍', '🌏', '🪐', '⭐', '🌟', '✨', '⚡', '☄️', '🔥',
      '🌈', '☀️', '⛅', '☁️', '🌧️', '⛈️', '❄️', '☃️', '⛄', '💧', '☔', '☂️', '🌊',
    ],
  },
  {
    id: 'symbols',
    label: 'Símbolos',
    icon: '✅',
    emojis: [
      '✅', '❌', '❎', '✔️', '☑️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤',
      '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳', '🔲', '▪️', '▫️', '⬛', '⬜', '🔈', '🔇', '🔉',
      '🔊', '🔔', '🔕', '📣', '📢', '♻️', '✳️', '❇️', '✴️', '🆚', '🆕', '🆓', '🆒', '🆙', '🆗',
      '🔃', '🔄', '🔀', '🔁', '🔂', '▶️', '⏸️', '⏹️', '⏺️', '⏭️', '⏮️', '⏩', '⏪', '⏫', '⏬',
      '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↩️', '↪️', '⤴️', '⤵️', '➕',
      '➖', '➗', '✖️', '♾️', '💲', '💱', '™️', '©️', '®️', '〰️', '➰', '➿', '❗', '❓', '❕',
      '❔', '‼️', '⁉️',
    ],
  },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const [activeCategoryId, setActiveCategoryId] = useState(EMOJI_CATEGORIES[0].id);
  const activeCategory =
    EMOJI_CATEGORIES.find((category) => category.id === activeCategoryId) ?? EMOJI_CATEGORIES[0];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-full text-muted-foreground"
          aria-label="Inserir emoji"
        >
          <Smile />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        className="w-[min(20rem,calc(100vw-1rem))] p-2"
        onFocusOutside={(event) => event.preventDefault()}
      >
        <div className="mb-2 flex gap-0.5">
          {EMOJI_CATEGORIES.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setActiveCategoryId(category.id)}
              aria-label={category.label}
              aria-pressed={category.id === activeCategory.id}
              className={cn(
                'flex h-8 flex-1 items-center justify-center rounded-sm text-base transition-colors',
                'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                category.id === activeCategory.id && 'bg-surface-hover',
              )}
            >
              {category.icon}
            </button>
          ))}
        </div>
        <div className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto pr-1">
          {activeCategory.emojis.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onSelect(emoji)}
              aria-label={emoji}
              className="flex size-8 items-center justify-center rounded-sm text-xl leading-none transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
