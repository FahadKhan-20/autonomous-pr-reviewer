export interface AgentEventData {
  review_id: string;
  event_type: "node_started" | "reasoning" | "tool_call" | "finding" | "test_generated" | "node_finished" | "error" | "done" | "message";
  agent?: string;
  data: Record<string, any>;
  sequence_id: number;
  timestamp: string;
}

export type EventCallback = (event: AgentEventData) => void;

export class ReviewSSEClient {
  private eventSource: EventSource | null = null;
  private reviewId: string;
  private baseUrl: string;
  private onEvent: EventCallback;
  private onError?: (err: any) => void;
  private retryCount = 0;
  private maxRetries = 5;
  private isClosed = false;

  constructor(reviewId: string, onEvent: EventCallback, onError?: (err: any) => void) {
    this.reviewId = reviewId;
    this.onEvent = onEvent;
    this.onError = onError;
    this.baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  }

  public connect(): void {
    if (this.isClosed) return;

    const streamUrl = `${this.baseUrl}/api/reviews/${this.reviewId}/stream`;
    this.eventSource = new EventSource(streamUrl);

    const eventNames = [
      "node_started",
      "reasoning",
      "tool_call",
      "finding",
      "test_generated",
      "node_finished",
      "error",
      "done",
      "message",
    ];

    eventNames.forEach((name) => {
      this.eventSource?.addEventListener(name, (e: MessageEvent) => {
        try {
          const parsed: AgentEventData = JSON.parse(e.data);
          this.onEvent(parsed);
          if (name === "done" || name === "error") {
            this.disconnect();
          }
        } catch (err) {
          console.error("Failed to parse SSE event payload:", err, e.data);
        }
      });
    });

    this.eventSource.onerror = (e) => {
      if (this.isClosed) return;

      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        const backoff = Math.min(1000 * Math.pow(2, this.retryCount), 10000);
        console.warn(`SSE connection interrupted. Reconnecting in ${backoff}ms...`);
        this.disconnect();
        setTimeout(() => this.connect(), backoff);
      } else {
        console.error("SSE connection closed: Max reconnection attempts reached.");
        this.onError?.(e);
        this.disconnect();
      }
    };
  }

  public disconnect(): void {
    this.isClosed = true;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}
