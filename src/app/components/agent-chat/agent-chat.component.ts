import {
  Component,
  inject,
  signal,
  effect,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  HostListener,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AssistantService, AssistantInfo, ChatMessage } from '../../services/assistant.service';
import { MarkdownPipe } from '../../pipes/markdown.pipe';

@Component({
  selector: 'app-agent-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, MarkdownPipe],
  templateUrl: './agent-chat.component.html',
  styleUrl: './agent-chat.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AgentChatComponent implements AfterViewChecked {
  assistantService = inject(AssistantService);

  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;
  @ViewChild('inputField') private inputField?: ElementRef<HTMLTextAreaElement>;

  readonly isOpen = signal<boolean>(false);
  readonly isAgentMenuOpen = signal<boolean>(false);
  readonly messageText = signal<string>('');
  readonly expandedThoughts = signal<Record<number, boolean>>({});

  // Floating trigger button position
  readonly buttonPos = signal<{ x: number; y: number }>({ x: 0, y: 0 });

  // Chat window size & anchor
  readonly windowSize = signal<{ width: number; height: number }>({ width: 560, height: 720 });

  readonly isUserScrolledUp = signal<boolean>(false);

  private isDraggingButton = false;
  private dragStartMouse = { x: 0, y: 0 };
  private dragStartButton = { x: 0, y: 0 };
  private didDragDistance = false;

  private isResizing = false;
  private resizeHandle: 'top' | 'left' | 'top-left' | null = null;
  private resizeStartMouse = { x: 0, y: 0 };
  private resizeStartSize = { width: 560, height: 720 };

  private shouldScrollBottom = false;
  private lastScrollTop = 0;
  private previousStepsCount = 0;
  private previousThought = '';
  private previousFeedCount = 0;
  private previousLastMsgSig = '';
  private previousIsThinking = false;

  constructor() {
    this.loadState();

    // Scroll to bottom whenever new messages arrive unless user scrolled up
    effect(() => {
      const feed = this.assistantService.feed();
      if (feed && feed.length > 0 && !this.isUserScrolledUp()) {
        this.shouldScrollBottom = true;
      }
    });
  }

  onChatScroll(): void {
    const el = this.messagesContainer?.nativeElement;
    if (!el) return;
    const currentScrollTop = el.scrollTop;
    const distanceFromBottom = el.scrollHeight - currentScrollTop - el.clientHeight;

    if (currentScrollTop < this.lastScrollTop - 4) {
      // User explicitly scrolled up
      this.isUserScrolledUp.set(true);
    } else if (distanceFromBottom <= 25) {
      // Reached near the bottom
      this.isUserScrolledUp.set(false);
    }
    this.lastScrollTop = currentScrollTop;
  }

  onChatWheel(event: WheelEvent): void {
    if (event.deltaY < 0) {
      // Scrolling up with mouse wheel
      this.isUserScrolledUp.set(true);
    } else if (event.deltaY > 0) {
      const el = this.messagesContainer?.nativeElement;
      if (el) {
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distanceFromBottom <= 25) {
          this.isUserScrolledUp.set(false);
        }
      }
    }
  }

  scrollToBottomManually(): void {
    this.isUserScrolledUp.set(false);
    this.shouldScrollBottom = true;
    this.scrollToBottom();
  }

  ngAfterViewChecked(): void {
    const isThinking = this.assistantService.isLoading() || this.assistantService.isAwaitingResponse();
    const curSteps = this.assistantService.thinkingSteps().length;
    const curThought = this.assistantService.agentThought();
    const curFeed = this.assistantService.feed();
    const curFeedCount = curFeed.length;
    const lastMsg = curFeedCount > 0 ? curFeed[curFeedCount - 1] : null;
    const curLastMsgSig = lastMsg ? `${lastMsg.id}_${(lastMsg.message || '').length}_${(lastMsg.steps || []).length}` : '';

    const hasNewSteps = curSteps !== this.previousStepsCount || curThought !== this.previousThought;
    const hasNewFeed = curFeedCount !== this.previousFeedCount || curLastMsgSig !== this.previousLastMsgSig;
    const thinkingJustStarted = isThinking && !this.previousIsThinking;
    const hasNewContent = hasNewSteps || hasNewFeed || thinkingJustStarted;

    if (this.shouldScrollBottom || (hasNewContent && !this.isUserScrolledUp())) {
      this.scrollToBottom();
      this.shouldScrollBottom = false;
    }

    this.previousStepsCount = curSteps;
    this.previousThought = curThought;
    this.previousFeedCount = curFeedCount;
    this.previousLastMsgSig = curLastMsgSig;
    this.previousIsThinking = isThinking;
  }

  private loadState(): void {
    if (typeof window === 'undefined') return;

    // Load button position (default: bottom-right)
    const savedPos = localStorage.getItem('vide_agent_button_pos');
    if (savedPos) {
      try {
        const parsed = JSON.parse(savedPos);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          this.buttonPos.set(this.clampButtonPos(parsed.x, parsed.y));
        }
      } catch (e) {}
    } else {
      const defaultX = Math.max(20, window.innerWidth - 80);
      const defaultY = Math.max(20, window.innerHeight - 80);
      this.buttonPos.set({ x: defaultX, y: defaultY });
    }

    // Load window size
    const savedSize = localStorage.getItem('vide_agent_chat_size');
    if (savedSize) {
      try {
        const parsed = JSON.parse(savedSize);
        if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
          this.windowSize.set({
            width: Math.min(Math.max(340, parsed.width), window.innerWidth - 40),
            height: Math.min(Math.max(380, parsed.height), window.innerHeight - 40)
          });
        }
      } catch (e) {}
    }

    // Load open state
    const savedOpen = localStorage.getItem('vide_agent_chat_open');
    if (savedOpen === 'true') {
      this.isOpen.set(true);
      this.shouldScrollBottom = true;
    }
  }

  private clampButtonPos(x: number, y: number): { x: number; y: number } {
    const minX = 10;
    const maxX = Math.max(10, window.innerWidth - 70);
    const minY = 10;
    const maxY = Math.max(10, window.innerHeight - 70);
    return {
      x: Math.min(Math.max(minX, x), maxX),
      y: Math.min(Math.max(minY, y), maxY)
    };
  }

  toggleChat(): void {
    if (this.didDragDistance) return; // Prevent toggle if user was dragging
    const nextState = !this.isOpen();
    this.isOpen.set(nextState);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('vide_agent_chat_open', String(nextState));
    }
    if (nextState) {
      this.shouldScrollBottom = true;
      setTimeout(() => {
        this.inputField?.nativeElement?.focus();
      }, 100);
    }
  }

  closeChat(): void {
    this.isOpen.set(false);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('vide_agent_chat_open', 'false');
    }
  }

  toggleAgentMenu(): void {
    this.isAgentMenuOpen.update(v => !v);
  }

  selectAgent(agent: AssistantInfo): void {
    this.isAgentMenuOpen.set(false);
    this.assistantService.selectAgent(agent);
  }

  refreshFeed(): void {
    this.assistantService.refresh();
  }

  toggleThoughts(msgId: number | undefined): void {
    if (msgId === undefined) return;
    this.expandedThoughts.update(curr => ({
      ...curr,
      [msgId]: !curr[msgId]
    }));
  }

  isThoughtsExpanded(msgId: number | undefined): boolean {
    if (msgId === undefined) return false;
    return !!this.expandedThoughts()[msgId];
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  async sendMessage(): Promise<void> {
    const text = this.messageText();
    if (!text.trim() || this.assistantService.isLoading()) return;
    this.messageText.set('');
    this.isUserScrolledUp.set(false);
    this.shouldScrollBottom = true;
    this.scrollToBottom();
    await this.assistantService.sendMessage(text);
    if (!this.isUserScrolledUp()) {
      this.shouldScrollBottom = true;
    }
  }

  private scrollToBottom(): void {
    try {
      if (this.messagesContainer) {
        const el = this.messagesContainer.nativeElement;
        el.scrollTop = el.scrollHeight;
      }
    } catch (e) {}
  }

  // --- Button Dragging Handlers ---
  onButtonPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.isDraggingButton = true;
    this.didDragDistance = false;
    this.dragStartMouse = { x: event.clientX, y: event.clientY };
    this.dragStartButton = { ...this.buttonPos() };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }

  onButtonPointerMove(event: PointerEvent): void {
    if (!this.isDraggingButton) return;
    const dx = event.clientX - this.dragStartMouse.x;
    const dy = event.clientY - this.dragStartMouse.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      this.didDragDistance = true;
    }
    const newX = this.dragStartButton.x + dx;
    const newY = this.dragStartButton.y + dy;
    this.buttonPos.set(this.clampButtonPos(newX, newY));
  }

  onButtonPointerUp(event: PointerEvent): void {
    if (!this.isDraggingButton) return;
    this.isDraggingButton = false;
    try {
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    } catch (e) {}
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('vide_agent_button_pos', JSON.stringify(this.buttonPos()));
    }
  }

  // --- Window Resize Handlers ---
  onResizeStart(event: PointerEvent, handle: 'top' | 'left' | 'top-left'): void {
    event.preventDefault();
    event.stopPropagation();
    this.isResizing = true;
    this.resizeHandle = handle;
    this.resizeStartMouse = { x: event.clientX, y: event.clientY };
    this.resizeStartSize = { ...this.windowSize() };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }

  @HostListener('window:pointermove', ['$event'])
  onGlobalPointerMove(event: PointerEvent): void {
    if (!this.isResizing || !this.resizeHandle) return;

    const dx = event.clientX - this.resizeStartMouse.x;
    const dy = event.clientY - this.resizeStartMouse.y;

    let newWidth = this.resizeStartSize.width;
    let newHeight = this.resizeStartSize.height;

    // Resizing from left edge expands width to the left (dx < 0 increases width)
    if (this.resizeHandle === 'left' || this.resizeHandle === 'top-left') {
      newWidth = this.resizeStartSize.width - dx;
    }

    // Resizing from top edge expands height upwards (dy < 0 increases height)
    if (this.resizeHandle === 'top' || this.resizeHandle === 'top-left') {
      newHeight = this.resizeStartSize.height - dy;
    }

    const clampedWidth = Math.min(Math.max(340, newWidth), window.innerWidth - 40);
    const clampedHeight = Math.min(Math.max(380, newHeight), window.innerHeight - 40);

    this.windowSize.set({ width: clampedWidth, height: clampedHeight });
  }

  @HostListener('window:pointerup', ['$event'])
  onGlobalPointerUp(event: PointerEvent): void {
    if (this.isResizing) {
      this.isResizing = false;
      this.resizeHandle = null;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('vide_agent_chat_size', JSON.stringify(this.windowSize()));
      }
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.buttonPos.set(this.clampButtonPos(this.buttonPos().x, this.buttonPos().y));
  }
}
