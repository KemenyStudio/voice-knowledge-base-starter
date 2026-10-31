import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BookOpenText } from "lucide-react";
import ResultViewer from "./result-viewer";

export default function Evaluations({ chatbotId }: { chatbotId: string | undefined; }) {
  return (
    <motion.div
      className="w-full h-full p-4 bg-white shadow-lg overflow-hidden flex flex-col dark:bg-black"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="h-full flex flex-col">
        <CardHeader>
          <CardTitle className="text-2xl font-bold flex items-center gap-3">
            <BookOpenText className="h-6 w-6 text-blue-500" />
            Evaluations Review
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-grow overflow-auto">
          <ResultViewer chatbotId={chatbotId} />
        </CardContent>
      </Card>
    </motion.div>
  );
}