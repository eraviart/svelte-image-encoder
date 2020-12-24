export interface Transform {
    getMinScale(): number;
    getScale(): number;
    setScale(s: number): void;
    getOffsetX(): number;
    getOffsetY(): number;
    setOffsetX(o: number): void;
    setOffsetY(o: number): void;
    setDragging(d: boolean): void;
    getDragging(): boolean;
}
declare function withPointers(node: HTMLElement, transform: Transform): {
    destroy: () => void;
};
export declare const panHandler: typeof withPointers;
export {};
