import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { invoke } from '@tauri-apps/api/core';

export interface AssistantInfo {
  identifier: string;
  name: string;
  title: string;
  image: string;
  greeting: string;
}

export interface ThinkingStep {
  type: 'thought' | 'tool';
  text: string;
  tool?: string;
  done?: boolean;
  timestamp?: string;
}

export interface ChatMessage {
  id?: number;
  role: 'user' | 'assistant' | 'system';
  message: string;
  model?: string;
  elapsed?: number;
  tokens?: number;
  executed_tools?: string | null;
  thoughts?: string | null;
  steps?: ThinkingStep[];
  tm?: string;
  created_at?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AssistantService {
  private http = inject(HttpClient);

  readonly baseUrl = signal<string>('https://assistant.heliconbooks.com');
  readonly clientId = `vide_${Math.random().toString(36).substring(2, 10)}`;

  readonly assistants = signal<AssistantInfo[]>(this.getInitialAssistants());

  // Ada is the default active agent
  readonly currentAgent = signal<AssistantInfo>(this.getInitialAgent());
  readonly sessionToken = signal<string | null>(null);
  readonly feed = signal<ChatMessage[]>(this.getInitialFeed());
  readonly isLoading = signal<boolean>(false);
  readonly isRefreshing = signal<boolean>(false);
  readonly isFeedLoading = signal<boolean>(false);
  readonly isAuthenticated = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  // Floating agent avatar button visibility (default: false, controlled via AI Settings)
  readonly showFloatingButton = signal<boolean>(this.getInitialFloatingButtonState());

  // Chat window open state
  readonly isChatOpen = signal<boolean>(false);

  // Live thinking steps and audio state
  readonly isAwaitingResponse = signal<boolean>(false);
  readonly isToolRunning = signal<boolean>(false);
  readonly agentThought = signal<string>('');
  readonly thinkingSteps = signal<ThinkingStep[]>([]);

  private sseSource: EventSource | null = null;
  private sharedAudioCtx: AudioContext | null = null;

  constructor() {
    this.initAuthAndFeed();
  }

  private getInitialFeed(): ChatMessage[] {
    if (typeof localStorage !== 'undefined') {
      try {
        const agent = this.getInitialAgent();
        const cached = localStorage.getItem(`vide_cached_feed_${agent.identifier}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
    }
    return [];
  }

  private getInitialAssistants(): AssistantInfo[] {
    const defaultList: AssistantInfo[] = [
      {
        identifier: 'ada',
        name: 'עדה',
        title: 'מתכנתת ומפתחת מערכות',
        image: 'https://assistant.heliconbooks.com/images/ada.jpg',
        greeting: 'שלום! עדה מוכנה לפיתוח, כתיבת קוד ועריכת קבצים.'
      },
      {
        identifier: 'tara',
        name: 'טארה',
        title: 'עוזרת אישית ומנהלת משרד',
        image: 'https://assistant.heliconbooks.com/images/tara.jpg',
        greeting: 'שלום! מוכנה לקבל פקודות.'
      }
    ];

    if (typeof localStorage !== 'undefined') {
      try {
        const cached = localStorage.getItem('vide_cached_assistants');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const filtered = parsed.filter(
              (a: AssistantInfo) =>
                a &&
                a.identifier &&
                a.identifier !== 'boardroom' &&
                !a.identifier.startsWith('_') &&
                !(a.name && (a.name.includes('חדר ישיבות') || a.name.toLowerCase().includes('boardroom')))
            );
            if (filtered.length > 0) {
              return filtered;
            }
          }
        }
      } catch {}
    }
    return defaultList;
  }

  private getInitialAgent(): AssistantInfo {
    const list = this.assistants();
    if (typeof localStorage !== 'undefined') {
      const savedId = localStorage.getItem('vide_selected_agent');
      if (savedId && savedId !== 'boardroom') {
        const found = list.find((a) => a.identifier === savedId);
        if (found) return found;
      }
    }
    return list.find((a) => a.identifier === 'ada') || list[0];
  }

  private getInitialFloatingButtonState(): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
      return localStorage.getItem('vide_show_agent_floating_btn') === 'true';
    } catch {
      return false;
    }
  }

  public setShowFloatingButton(val: boolean): void {
    this.showFloatingButton.set(val);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('vide_show_agent_floating_btn', val ? 'true' : 'false');
      } catch {}
    }
    if (val) {
      // Fetch assistants in parallel without blocking
      this.loadAssistants().catch((err) =>
        console.warn('[AssistantService] Background loadAssistants failed:', err)
      );
    }
  }

  public toggleFloatingButton(): void {
    this.setShowFloatingButton(!this.showFloatingButton());
  }

  public openChat(): void {
    this.isChatOpen.set(true);
  }

  public closeChat(): void {
    this.isChatOpen.set(false);
  }

  public toggleChat(): void {
    this.isChatOpen.update((v) => !v);
  }

  async initAuthAndFeed(): Promise<void> {
    try {
      // 1. Try localStorage first
      let token = typeof localStorage !== 'undefined'
        ? (localStorage.getItem('vide_session_token') || localStorage.getItem('session_token'))
        : null;

      // 2. If not in localStorage, query Vector's local SQLite storage via Tauri
      if (!token) {
        try {
          const vectorToken = await invoke<string | null>('get_vector_session_token');
          if (vectorToken) {
            token = vectorToken;
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('vide_session_token', vectorToken);
            }
          }
        } catch (e) {
          console.warn('[AssistantService] Failed to read token from Vector storage:', e);
        }
      }

      if (token) {
        this.sessionToken.set(token);
        this.isAuthenticated.set(true);
      }

      // Load assistants in parallel/background so it does not block SSE or feed loading
      this.loadAssistants().catch((err) =>
        console.warn('[AssistantService] Initial loadAssistants error:', err)
      );
      this.initSSE();
      await this.loadFeed();
    } catch (e: any) {
      console.error('[AssistantService] Init error:', e);
    }
  }

  // --- SSE (Server-Sent Events) ---
  private initSSE(): void {
    if (typeof EventSource === 'undefined') return;
    if (this.sseSource) {
      try { this.sseSource.close(); } catch (e) {}
    }

    const sseUrl = `${this.baseUrl()}/events?client=web&clientId=${this.clientId}`;
    try {
      this.sseSource = new EventSource(sseUrl);
      this.sseSource.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          this.handleSSEEvent(payload);
        } catch (err) {
          console.error('[SSE] Error parsing event:', err);
        }
      };

      this.sseSource.onerror = () => {
        if (this.sseSource) {
          try { this.sseSource.close(); } catch (e) {}
          this.sseSource = null;
        }
        setTimeout(() => this.initSSE(), 3500);
      };
    } catch (e) {
      console.warn('[AssistantService] SSE initialization failed:', e);
    }
  }

  private handleSSEEvent(data: any): void {
    if (!data) return;

    if (data.type === 'feed_update' || data.event === 'feed_update') {
      this.playChimeSound();
      this.loadFeed(false);
      return;
    }

    if (data.type === 'new_chat_message') {
      this.playChimeSound();
      this.loadFeed(false);
      return;
    }

    // Process thinking and tool execution events
    if (data.event) {
      const rawStepText = data.step || data.message || '';
      const cleanText = rawStepText.replace(/^הושלם:\s*/, '');
      const isKeyOrModelSwitch = cleanText.includes('מחליפה מפתח') || cleanText.includes('עוברת למודל');
      const timestamp = data.timestamp || new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

      if (isKeyOrModelSwitch) {
        this.playModelSwitchSound();
      } else if (data.event === 'tool_start') {
        this.isToolRunning.set(true);
        this.playToolStartSound();
      } else if (data.event === 'thinking_start') {
        this.playThinkingStartSound();
      } else if (data.event === 'tool_done') {
        this.isToolRunning.set(false);
        this.playToolDoneSound();
      } else if (data.event === 'thinking_completed') {
        this.isToolRunning.set(false);
        this.playThinkingDoneSound();
      }

      if (data.event === 'agent_thought') {
        const thought = (data.step || data.message || '').trim();
        if (thought) {
          this.agentThought.set(thought);
          this.thinkingSteps.update(steps => {
            const last = steps.length > 0 ? steps[steps.length - 1] : null;
            if (last && last.type === 'thought' && last.text === thought) {
              return steps;
            }
            return [...steps, { type: 'thought', text: thought, done: true, timestamp }];
          });
        }
        return;
      }

      if (data.event === 'thinking_start' || data.event === 'tool_start') {
        if (!cleanText) return;
        this.thinkingSteps.update(steps => {
          const exists = steps.some(s => s.type === 'tool' && !s.done && ((data.tool && s.tool === data.tool) || s.text === cleanText));
          if (exists) return steps;
          return [...steps, { type: 'tool', text: cleanText, tool: data.tool, done: false, timestamp }];
        });
      } else if (data.event === 'tool_done') {
        this.thinkingSteps.update(steps => {
          let markedDone = false;
          return steps.map(s => {
            if (s.type === 'tool' && !markedDone && !s.done && ((data.tool && s.tool === data.tool) || s.text === cleanText)) {
              markedDone = true;
              return { ...s, done: true };
            }
            return s;
          });
        });
      }
    }
  }

  // --- Web Audio Synthesizer Tones ---
  private getAudioContext(): AudioContext | null {
    try {
      if (typeof window === 'undefined') return null;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;

      if (!this.sharedAudioCtx || this.sharedAudioCtx.state === 'closed') {
        this.sharedAudioCtx = new AudioCtx();
      }
      if (this.sharedAudioCtx.state === 'suspended') {
        this.sharedAudioCtx.resume().catch(() => {});
      }
      return this.sharedAudioCtx;
    } catch (e) {
      return null;
    }
  }

  private playSynthTone(freqs: number[], rampTime: number, totalDuration: number, type: OscillatorType = 'sine', maxGain = 0.28): void {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      const startTime = ctx.currentTime;
      osc.frequency.setValueAtTime(freqs[0], startTime);
      if (freqs.length > 1) {
        osc.frequency.exponentialRampToValueAtTime(freqs[freqs.length - 1], startTime + rampTime);
      }

      gain.gain.setValueAtTime(maxGain, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + totalDuration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + totalDuration);

      setTimeout(() => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch (e) {}
      }, Math.round((totalDuration + 0.1) * 1000));
    } catch (e) {}
  }

  public playChimeSound(): void {
    this.playSynthTone([587.33, 880], 0.12, 0.30, 'sine', 0.32);
  }

  public playThinkingStartSound(): void {
    this.playSynthTone([329.63, 440], 0.10, 0.28, 'sine', 0.22);
  }

  public playThinkingDoneSound(): void {
    this.playSynthTone([440, 659.25], 0.12, 0.30, 'sine', 0.28);
  }

  public playToolStartSound(): void {
    this.playSynthTone([392, 523.25], 0.12, 0.30, 'sine', 0.30);
  }

  public playToolDoneSound(): void {
    this.playSynthTone([523.25, 659.25, 783.99], 0.14, 0.32, 'sine', 0.32);
  }

  public playModelSwitchSound(): void {
    this.playSynthTone([440, 554.37, 659.25], 0.15, 0.32, 'triangle', 0.35);
  }

  // --- API Communication ---
  private getHeaders(): HttpHeaders {
    let headers = new HttpHeaders();
    const token = this.sessionToken();
    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }
    return headers;
  }

  async loadAssistants(): Promise<void> {
    const url = `${this.baseUrl()}/api/assistants`;
    try {
      const res = await firstValueFrom(
        this.http.get<any[]>(url, { headers: this.getHeaders() })
      );
      if (Array.isArray(res) && res.length > 0) {
        const loaded: AssistantInfo[] = [];
        for (const a of res) {
          if (a.identifier && (a.identifier.startsWith('_') || a.identifier === 'boardroom')) continue;
          if (a.name && (a.name.includes('חדר ישיבות') || a.name.toLowerCase().includes('boardroom'))) continue;
          if (a.full_name && (a.full_name.includes('חדר ישיבות') || a.full_name.toLowerCase().includes('boardroom'))) continue;

          let toolsArr: string[] = [];
          if (Array.isArray(a.tools)) {
            toolsArr = a.tools;
          } else if (typeof a.tools === 'string') {
            try {
              toolsArr = JSON.parse(a.tools);
            } catch (e) {
              toolsArr = [];
            }
          }
          const desktopTools = [
            'read_file',
            'list_directory',
            'write_file',
            'patch_file',
            'run_command',
            'find_files',
            'grep_search',
          ];
          const hasDesktopAccess =
            a.hasDesktopAccess ??
            a.has_desktop_tools ??
            (Array.isArray(toolsArr) && toolsArr.some((t) => desktopTools.includes(t)));

          const autoTitle = a.title || (a.personality ? a.personality.substring(0, 35) : 'סוכנת');
          let img = a.image || '';
          if (img && !img.startsWith('http://') && !img.startsWith('https://')) {
            img = `${this.baseUrl()}${img.startsWith('/') ? img : '/' + img}`;
          }

          loaded.push({
            identifier: a.identifier,
            name: a.full_name || a.name || a.identifier,
            title: autoTitle,
            image:
              img ||
              (hasDesktopAccess
                ? 'https://assistant.heliconbooks.com/images/ada.jpg'
                : 'https://assistant.heliconbooks.com/images/tara.jpg'),
            greeting: a.greeting || `שלום! ${a.full_name || a.name || a.identifier} מוכנה לפעולה.`,
          });
        }

        if (loaded.length > 0) {
          this.assistants.set(loaded);
          if (typeof localStorage !== 'undefined') {
            try {
              localStorage.setItem('vide_cached_assistants', JSON.stringify(loaded));
            } catch {}
          }

          // Restore saved selection or default to 'ada'
          const savedId =
            typeof localStorage !== 'undefined'
              ? localStorage.getItem('vide_selected_agent')
              : null;
          const targetId =
            savedId && savedId !== 'boardroom'
              ? savedId
              : this.currentAgent()?.identifier && this.currentAgent()?.identifier !== 'boardroom'
              ? this.currentAgent().identifier
              : 'ada';
          const target =
            loaded.find((a) => a.identifier === targetId) ||
            loaded.find((a) => a.identifier === 'ada') ||
            loaded[0];
          if (target) {
            this.currentAgent.set(target);
          }
        }
      }
    } catch (err) {
      console.warn('[AssistantService] Failed to load assistants from API:', err);
    }
  }

  async loadFeed(showRefreshing = false): Promise<void> {
    const agent = this.currentAgent();
    if (!agent) return;

    this.isFeedLoading.set(true);
    if (showRefreshing) {
      this.isRefreshing.set(true);
    }
    this.errorMessage.set(null);

    const url = `${this.baseUrl()}/api/officemanager/feed?agent_id=${agent.identifier}&user=admin`;

    try {
      const res = await firstValueFrom(
        this.http.get<any>(url, { headers: this.getHeaders() })
      );

      if (res && res.success) {
        const feedList: ChatMessage[] = res.feed || [];
        this.feed.set(feedList);
        this.isAuthenticated.set(true);
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(`vide_cached_feed_${agent.identifier}`, JSON.stringify(feedList));
          } catch {}
        }
      } else {
        if (res && res.error) {
          this.errorMessage.set(res.error);
        }
      }
    } catch (err: any) {
      console.error('[AssistantService] Load feed error:', err);
      if (err?.status === 401) {
        this.isAuthenticated.set(false);
        this.errorMessage.set('נדרשת התחברות לחשבון');
      } else {
        this.errorMessage.set(err?.message || 'שגיאת תקשורת בטעינת השיחה');
      }
    } finally {
      this.isFeedLoading.set(false);
      this.isRefreshing.set(false);
    }
  }

  async refresh(): Promise<void> {
    await this.loadAssistants();
    await this.loadFeed(true);
  }

  async selectAgent(agent: AssistantInfo): Promise<void> {
    if (this.currentAgent().identifier === agent.identifier) return;
    this.currentAgent.set(agent);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('vide_selected_agent', agent.identifier);
      } catch {}
    }
    let initialCached: ChatMessage[] = [];
    if (typeof localStorage !== 'undefined') {
      try {
        const cached = localStorage.getItem(`vide_cached_feed_${agent.identifier}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) initialCached = parsed;
        }
      } catch {}
    }
    this.feed.set(initialCached);
    this.thinkingSteps.set([]);
    await this.loadFeed();
  }

  async sendMessage(text: string): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed || this.isLoading()) return false;

    const agent = this.currentAgent();
    const tempUserMsg: ChatMessage = {
      id: Date.now(),
      role: 'user',
      message: trimmed,
      tm: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    };

    this.feed.update(f => [...f, tempUserMsg]);
    this.isLoading.set(true);
    this.isAwaitingResponse.set(true);
    this.thinkingSteps.set([]);
    this.agentThought.set('');
    this.errorMessage.set(null);

    const url = `${this.baseUrl()}/api/officemanager/chat`;
    const payload = {
      agent_id: agent.identifier,
      user: 'admin',
      message: trimmed,
      client_id: this.clientId
    };

    try {
      const res = await firstValueFrom(
        this.http.post<any>(url, payload, { headers: this.getHeaders() })
      );

      const capturedSteps = [...this.thinkingSteps()];

      if (res && res.success) {
        if (res.feed && Array.isArray(res.feed)) {
          const updated = [...res.feed];
          if (capturedSteps.length > 0) {
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].role === 'assistant') {
                updated[i].steps = capturedSteps;
                break;
              }
            }
          }
          this.feed.set(updated);
        } else if (res.reply) {
          const assistantMsg: ChatMessage = {
            id: Date.now(),
            role: 'assistant',
            message: res.reply,
            model: res.model,
            elapsed: res.elapsed,
            tokens: res.tokens,
            executed_tools: res.executed_tools,
            thoughts: res.thoughts,
            steps: capturedSteps.length > 0 ? capturedSteps : undefined,
            tm: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
          };
          this.feed.update(f => [...f, assistantMsg]);
        }
        this.playChimeSound();
        return true;
      } else {
        const errText = res?.error || 'שגיאה בקבלת תשובה מהסוכנת';
        this.errorMessage.set(errText);
        this.feed.update(f => [...f, {
          role: 'system',
          message: `⚠️ תקלה: ${errText}`
        }]);
        return false;
      }
    } catch (err: any) {
      console.error('[AssistantService] Send message error:', err);
      const errMsg = err?.message || 'שגיאת תקשורת מול השרת';
      this.errorMessage.set(errMsg);
      this.feed.update(f => [...f, {
        role: 'system',
        message: `⚠️ תקלה בשליחת הודעה: ${errMsg}`
      }]);
      return false;
    } finally {
      this.isLoading.set(false);
      this.isAwaitingResponse.set(false);
    }
  }

  loginWithGoogle(): void {
    const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
    const authUrl = `${this.baseUrl()}/auth/google?redirect_to=${encodeURIComponent(origin)}`;

    const messageHandler = (event: MessageEvent) => {
      if (event.data && event.data.type === 'GOOGLE_AUTH_SUCCESS' && event.data.session_token) {
        window.removeEventListener('message', messageHandler);
        const token = event.data.session_token;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('vide_session_token', token);
        }
        this.sessionToken.set(token);
        this.isAuthenticated.set(true);
        this.loadAssistants().then(() => this.loadFeed());
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('message', messageHandler);
      const width = 520;
      const height = 650;
      const left = window.screen ? (window.screen.width / 2 - width / 2) : 100;
      const top = window.screen ? (window.screen.height / 2 - height / 2) : 100;
      window.open(authUrl, 'GoogleAuthPopup', `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,status=yes`);
    }
  }
}
