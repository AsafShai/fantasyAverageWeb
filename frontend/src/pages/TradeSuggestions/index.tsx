import React, { useState, useEffect } from 'react';
import { TeamSelector } from './components/TeamSelector';
import { TradeSuggestionCard } from './components/TradeSuggestionCard';
import { useGetTradeSuggestionsQuery } from '../../store/api/fantasyApi';
import LoadingSpinner from '../../components/LoadingSpinner';
import type { Team, TradeSuggestionsResponse } from '../../types/api';

type ViewMode = 'totals' | 'averages';

const getErrorMessage = (error: unknown): string => {
  if (!error) return 'An error occurred';
  
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const errorData = (error as { data?: unknown }).data;
    if (errorData && typeof errorData === 'object' && errorData !== null && 'message' in errorData) {
      const message = (errorData as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }
  }
  
  if (error instanceof Error) {
    return error.message;
  }
  
  if (typeof error === 'string') {
    return error;
  }
  
  return 'An error occurred';
};

export const TradeSuggestions: React.FC = () => {
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('totals');
  const [currentSuggestions, setCurrentSuggestions] = useState<TradeSuggestionsResponse | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [shouldFetch, setShouldFetch] = useState<boolean>(false);

  const {
    data: suggestions,
    isLoading: queryLoading,
    error,
    refetch,
  } = useGetTradeSuggestionsQuery(selectedTeam?.team_id!, {
    skip: !selectedTeam || !shouldFetch,
  });

  // Clear suggestions when team changes
  useEffect(() => {
    if (selectedTeam) {
      setCurrentSuggestions(null);
      setIsGenerating(false);
      setShouldFetch(false);
    }
  }, [selectedTeam]);

  // Update current suggestions when new data arrives
  useEffect(() => {
    if (suggestions && !queryLoading) {
      setCurrentSuggestions(suggestions);
      setIsGenerating(false);
    }
  }, [suggestions, queryLoading]);

  // Stop generating state on error so UI buttons/spinner reset and show error
  useEffect(() => {
    if (error && !queryLoading) {
      setIsGenerating(false);
    }
  }, [error, queryLoading]);

  const isAnalyzing = isGenerating || queryLoading;
  const showError = Boolean(error) && !queryLoading && !isGenerating;

  const handleGenerateTrades = (): void => {
    if (!selectedTeam || isAnalyzing) return;
    setIsGenerating(true);
    setCurrentSuggestions(null);
    setShouldFetch(true);
  };

  const handleReset = (): void => {
    setSelectedTeam(null);
    setCurrentSuggestions(null);
    setIsGenerating(false);
    setShouldFetch(false);
  };

  const handleRetry = (): void => {
    if (!selectedTeam || isAnalyzing) return;
    setIsGenerating(true);
    setShouldFetch(true);
    refetch();
  };

  const handleGenerateNew = (): void => {
    if (!selectedTeam || isAnalyzing) return;
    setIsGenerating(true);
    setCurrentSuggestions(null);
    setShouldFetch(true);
    refetch();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-3">
          🤖 AI Trade Suggestions
        </h1>
        <p className="text-gray-600 max-w-2xl mx-auto">
          Select your team and let our AI analyze your needs to suggest optimal trades with other teams
        </p>
      </div>

      <div className="flex justify-center mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-1 shadow-sm">
          <button
            onClick={() => setViewMode('totals')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              viewMode === 'totals'
                ? 'bg-blue-100 text-blue-700 shadow-sm'
                : 'text-gray-600 hover:text-blue-600 hover:bg-blue-50'
            }`}
          >
            📊 Total Stats
          </button>
          <button
            onClick={() => setViewMode('averages')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              viewMode === 'averages'
                ? 'bg-blue-100 text-blue-700 shadow-sm'
                : 'text-gray-600 hover:text-blue-600 hover:bg-blue-50'
            }`}
          >
            📈 Per Game Averages
          </button>
        </div>
      </div>

      {!currentSuggestions && (
        <div className="max-w-md mx-auto mb-8">
          <TeamSelector
            selectedTeam={selectedTeam}
            onTeamSelect={setSelectedTeam}
            disabled={isAnalyzing}
          />
          
          {selectedTeam && (
            <div className="mt-4 text-center">
              <button
                onClick={handleGenerateTrades}
                disabled={isAnalyzing}
                className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {isAnalyzing ? 'Generating...' : 'Generate Trade Suggestions'}
              </button>
            </div>
          )}
        </div>
      )}

      {isAnalyzing && (
        <div className="max-w-2xl mx-auto">
          <div className="card p-8">
            <div className="text-center">
              <div className="text-4xl mb-4">🤖</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                AI Analyzing Trades for {selectedTeam?.team_name}
              </h2>
              <p className="text-gray-600 mb-6">
                Our AI is working hard to find the best trade opportunities for your team
              </p>
              <LoadingSpinner />
              <p className="text-sm text-gray-500 mt-4">
                This usually takes 10-15 seconds. Please don't refresh the page.
              </p>
            </div>
          </div>
        </div>
      )}

      {showError && (
        <div className="max-w-md mx-auto mb-8">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
            <div className="text-red-600 font-medium mb-2">Failed to Generate Trades</div>
            <div className="text-red-500 text-sm mb-3">
              {getErrorMessage(error)}
            </div>
            <button
              onClick={handleRetry}
              className="px-4 py-2 bg-red-600 text-white text-sm rounded-md hover:bg-red-700"
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {currentSuggestions && (
        <div className="space-y-6">
          <div className="text-center">
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              Trade Suggestions for {currentSuggestions.user_team.team_name}
            </h2>
            <div className="flex justify-center space-x-4">
              <button
                onClick={handleGenerateNew}
                disabled={isAnalyzing}
                className="text-blue-600 hover:text-blue-700 font-medium disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                {isAnalyzing ? '⏳ Generating...' : '🔄 Generate New Suggestions'}
              </button>
              <span className="text-gray-300">|</span>
              <button
                onClick={handleReset}
                disabled={isAnalyzing}
                className="text-gray-600 hover:text-gray-700 font-medium disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                ← Select Different Team
              </button>
            </div>
          </div>

          <div className="grid gap-6 lg:gap-8">
            {currentSuggestions.trade_suggestions.map((suggestion, index) => (
              <TradeSuggestionCard
                key={`${suggestion.opponent_team.team_id}-${index}`}
                suggestion={suggestion}
                userTeam={currentSuggestions.user_team}
                index={index + 1}
                viewMode={viewMode}
              />
            ))}
          </div>
        </div>
      )}

      {!selectedTeam && !isAnalyzing && !currentSuggestions && (
        <div className="text-center py-16">
          <div className="text-6xl mb-6">🤝</div>
          <h3 className="text-xl font-semibold text-gray-800 mb-2">
            Ready to Find Great Trades?
          </h3>
          <p className="text-gray-600">
            Select your team above to get AI-powered trade recommendations
          </p>
        </div>
      )}
    </div>
  );
};

export default TradeSuggestions;