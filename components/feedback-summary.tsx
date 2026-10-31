interface FeedbackSummaryProps {
  positive: number;
  negative: number;
  unreviewed: number;
  totalQuestions: number;
}

export const FeedbackSummary = ({
  positive,
  negative,
  unreviewed,
  totalQuestions,
}: FeedbackSummaryProps) => {
  const reviewed = positive + negative;
  const unreviewedRate = ((unreviewed / totalQuestions) * 100).toFixed(1);
  const reviewedRate = ((reviewed / totalQuestions) * 100).toFixed(1);

  return (
    <div className="flex items-center justify-center gap-4 bg-gray-50 dark:bg-gray-900 p-3 rounded-lg">
      <div className="flex items-center text-green-700">
        <span className="mr-1">{positive}</span>👍
      </div>

      <div className="flex items-center text-red-700">
        <span className="mr-1">{negative}</span>👎
      </div>

      <div className="flex items-center text-gray-600">
        <span className="mr-1">{unreviewed}</span> unreviewed
        <span className="text-sm text-gray-500 ml-1">
          ({unreviewedRate}% pending)
        </span>
      </div>

      <div className="font-medium text-gray-800 dark:text-gray-200 border-l-2 border-gray-300 pl-4 ml-2">
        {reviewedRate}% reviewed
      </div>
    </div>
  );
};