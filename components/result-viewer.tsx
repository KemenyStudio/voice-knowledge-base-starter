import { useState, useEffect } from 'react';
import { marked } from 'marked';
import { FeedbackSummary } from "@/components/feedback-summary";

interface Metrics {
  [key: string]: number | string;
}

interface DetailedResult {
  question: string;
  expected_response: string;
  model_response: string;
  metrics?: Metrics;
}

interface Summary {
  total_responses: number;
  acceptable_responses: number;
  acceptance_rate: number;
  average_score: number;
}

interface EvaluationData {
  summary: Summary;
  detailed_results: DetailedResult[];
}

interface FeedbackData {
  summary?: {
    positive: number;
    negative: number;
  };
  feedback: {
    [key: number]: boolean;
  };
}

export default function ResultViewer({ chatbotId }: { chatbotId: string | undefined; }) {
  const [evaluationSets, setEvaluationSets] = useState<string[]>([]);
  const [currentSet, setCurrentSet] = useState('');
  const [evaluationData, setEvaluationData] = useState<EvaluationData | null>(null);
  const [feedbackData, setFeedbackData] = useState<FeedbackData>({ feedback: {} });
  const [filter, setFilter] = useState('all');
  const [userFeedbackSummary, setUserFeedbackSummary] = useState(0);

  useEffect(() => {
    loadEvaluationSets();
  }, []);

  const renderMarkdown = (text: string) => {
    if (!text) {
      return { __html: '' };
    }
    marked.setOptions({ breaks: true, gfm: true });
    return { __html: marked(text) };
  };

  const loadEvaluationSets = async () => {
    try {
      const response = await fetch(`/api/evaluation_results`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const files = await response.json();
      setEvaluationSets(files);

      if (files.length > 0) {
        setCurrentSet(files[0]);
        await loadEvaluationResults(files[0]);
      }
    } catch (error) {
      console.error('Error loading evaluation sets:', error);
    }
  };

  const loadEvaluationResults = async (evaluationSet: string) => {
    if (!evaluationSet) return;

    try {
      const response = await fetch(`/evaluation_results/${evaluationSet}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      setEvaluationData(data);
      await loadFeedback(evaluationSet);
    } catch (error) {
      console.error('Error loading evaluation results:', error);
    }
  };

  const loadFeedback = async (evaluationSet: string) => {
    try {
      const evalSet = evaluationSet.match(/\d{8}_\d{6}/)?.[0];
      if (!evalSet) return;

      const response = await fetch(`/api/feedback/${evalSet}`);
      if (!response.ok) throw new Error('Failed to load feedback');

      const data = await response.json();

      setFeedbackData(data);
      setUserFeedbackSummary(data.summary.positive + data.summary.negative);
    } catch (error) {
      console.error('Error loading feedback:', error);
    }
  };

  const submitFeedback = async (questionId: number, isPositive: boolean) => {
    if (!currentSet) return;

    try {
      const evalSet = currentSet.match(/\d{8}_\d{6}/)?.[0];
      if (!evalSet) return;

      const response = await fetch(`/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatbotId, questionId, isPositive, evaluationSet: evalSet })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Unknown error');
      }

      const summary = await response.json();
      setFeedbackData(prev => ({
        summary,
        feedback: { ...prev.feedback, [questionId]: isPositive }
      }));

      setUserFeedbackSummary(summary.positive + summary.negative);
    } catch (error) {
      console.error('Error submitting feedback:', error);
    }
  };

  return (
    <div className="font-sans leading-relaxed p-4 max-w-7xl mx-auto">
      <div className="flex justify-center gap-5 mb-5">
        <div className="flex items-center gap-3">
          <label htmlFor="evaluationSet" className="font-medium">Evals:</label>
          <select
            id="evaluationSet"
            value={currentSet}
            onChange={(e) => {
              setCurrentSet(e.target.value);
              loadEvaluationResults(e.target.value);
            }}
            className="p-2 text-base border rounded-md cursor-pointer min-w-[200px]"
          >
            <option value="">Select an evaluation set...</option>
            {evaluationSets.map(set => (
              <option key={set} value={set}>
                {set.split('/')[0].replace('evaluation_results_', '')}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <label htmlFor="feedbackFilter" className="font-medium">Filter:</label>
          <select
            id="feedbackFilter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="p-2 text-base border rounded-md cursor-pointer min-w-[200px]"
          >
            <option value="all">All Questions</option>
            <option value="unreviewed">Unreviewed</option>
            <option value="positive">👍 Positive Feedback</option>
            <option value="negative">👎 Negative Feedback</option>
          </select>
        </div>
      </div>

      {/* Summary Card */}
      {evaluationData && (
        <div className="rounded-lg p-5 mb-5 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">Summary Statistics</h2>
          <div className="grid grid-cols-5 gap-5">
            <div className="p-4 rounded-lg bg-gray-200 dark:bg-gray-900">
              <div className="text-sm">Total Responses:</div>
              <div className="text-lg font-medium">{evaluationData.summary.total_responses}</div>
            </div>
            <div className="p-4 rounded-lg bg-gray-200 dark:bg-gray-900">
              <div className="text-sm">Acceptable Responses:</div>
              <div className="text-lg font-medium">{evaluationData.summary.acceptable_responses}</div>
            </div>
            <div className="p-4 rounded-lg bg-gray-200 dark:bg-gray-900">
              <div className="text-sm">Acceptance Rate:</div>
              <div className="text-lg font-medium">{evaluationData.summary.acceptance_rate.toFixed(2)}%</div>
            </div>
            <div className="p-4 rounded-lg bg-gray-200 dark:bg-gray-900">
              <div className="text-sm">Average Score:</div>
              <div className="text-lg font-medium">{evaluationData.summary.average_score.toFixed(4)}</div>
            </div>
            {/* TODO: Add feedback summary */}
            <div className="p-4 rounded-lg bg-gray-200 dark:bg-gray-900">
              <div className="text-sm">User Feedback:</div>
              <div className="text-lg font-medium">{userFeedbackSummary}</div>
            </div>
          </div>
        </div>
      )}

      {evaluationData && feedbackData && (
        <FeedbackSummary
          positive={feedbackData.summary?.positive || 0}
          negative={feedbackData.summary?.negative || 0}
          unreviewed={evaluationData.detailed_results.length - (feedbackData.summary?.positive || 0) - (feedbackData.summary?.negative || 0)}
          totalQuestions={evaluationData.detailed_results.length}
        />
      )}

      {/* Results */}
      <div className="space-y-5">
        {evaluationData?.detailed_results
          .filter((_result, index) => {
            const feedback = feedbackData.feedback[index];
            switch (filter) {
              case 'unreviewed': return feedback === undefined;
              case 'positive': return feedback === true;
              case 'negative': return feedback === false;
              default: return true;
            }
          })
          .map((result, index) => (
            <div key={index} className="rounded-lg p-5 shadow-sm">
              <h3 className="text-lg font-semibold mb-3">Question {index + 1}</h3>
              <div className={`text-lg my-4 p-3 rounded-lg border-l-4 ${feedbackData.feedback[index] === true ? 'border-green-500' :
                feedbackData.feedback[index] === false ? 'border-red-500' : 'border-gray-500'
                }`}>
                <strong>Q:</strong> {result.question}
              </div>

              {/* Responses */}
              <div className="rounded-lg p-5 mb-4">
                <strong className="block mb-2 text-lg">Reference Response:</strong>
                <div
                  className="markdown-body"
                  dangerouslySetInnerHTML={renderMarkdown(result.expected_response)}
                />
              </div>

              <div className="rounded-lg p-5 mb-4">
                <strong className="block mb-2 text-lg">Generated Response:</strong>
                <div
                  className="markdown-body"
                  dangerouslySetInnerHTML={renderMarkdown(result.model_response)}
                />
              </div>

              {/* Feedback Buttons */}
              <div className="flex justify-center gap-3 my-4">
                <button
                  className={`px-4 py-2 text-lg rounded-md transition-all ${feedbackData.feedback[index] !== undefined
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:-translate-y-0.5 hover:shadow-md'
                    } bg-green-500 text-white`}
                  disabled={feedbackData.feedback[index] !== undefined}
                  onClick={() => submitFeedback(index, true)}
                >
                  👍
                </button>
                <button
                  className={`px-4 py-2 text-lg rounded-md transition-all ${feedbackData.feedback[index] !== undefined
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:-translate-y-0.5 hover:shadow-md'
                    } bg-red-500 text-white`}
                  disabled={feedbackData.feedback[index] !== undefined}
                  onClick={() => submitFeedback(index, false)}
                >
                  👎
                </button>
              </div>

              {/* Metrics */}
              {result.metrics && (
                <div className="grid grid-cols-5 gap-5">
                  {Object.entries(result.metrics).map(([key, value]) => (
                    <div key={key} className="p-4 rounded-lg">
                      <div className="text-sm">{key.replace(/_/g, ' ')}:</div>
                      <div className="text-lg font-medium">
                        {typeof value === 'number' ? value.toFixed(4) : value}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}