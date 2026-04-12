import { ScanningView } from '@/components/scanning-view';

export default function ScanningPage() {
  return (
    <div className="h-[calc(100dvh)] -mt-[calc(100px+1.5rem)] overflow-hidden flex flex-col">
      <div className="flex-1 flex flex-col">
        <ScanningView />
      </div>
    </div>
  );
}
