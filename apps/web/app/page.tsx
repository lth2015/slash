import { CommandBar } from "@/components/CommandBar";
import { EmptyOutput } from "@/components/EmptyOutput";
import { Sidebar } from "@/components/Sidebar";

export default function Home() {
  return (
    <div className="h-screen flex">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">
        <CommandBar />
        <EmptyOutput />
      </main>
    </div>
  );
}
