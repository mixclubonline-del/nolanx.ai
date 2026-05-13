type ObserverCallbacks = {
  onEnter?: () => void;
  onExit?: () => void;
};

class IntersectionObserverManager {
  private observer: IntersectionObserver | null = null;
  private callbacks = new Map<Element, ObserverCallbacks>();

  private ensureObserver(options?: IntersectionObserverInit) {
    if (this.observer || typeof window === 'undefined') return;

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const callbacks = this.callbacks.get(entry.target);
        if (!callbacks) return;

        if (entry.isIntersecting) {
          callbacks.onEnter?.();
        } else {
          callbacks.onExit?.();
        }
      });
    }, options);
  }

  observe(element: Element, callbacks: ObserverCallbacks, options?: IntersectionObserverInit) {
    this.ensureObserver(options);
    this.callbacks.set(element, callbacks);
    this.observer?.observe(element);
  }

  unobserve(element: Element) {
    this.callbacks.delete(element);
    this.observer?.unobserve(element);
  }
}

export const intersectionObserverManager = new IntersectionObserverManager();
