#!/usr/bin/env python3
"""
Test-driven development for pattern detection in namespace churn.
Tests written before implementation to ensure proper behavior.
"""

import unittest
import os
import sys
import importlib.util

# Add scripts directory to path for import
SCRIPT_PATH = os.path.join(os.path.dirname(__file__), '../../scripts/dotnet-namespace-churn.py')

def import_module_from_path(path):
    """Import a Python module from file path."""
    spec = importlib.util.spec_from_file_location("dotnet_namespace_churn", path)
    if spec and spec.loader:
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    return None


class TestPatternDetector(unittest.TestCase):
    """Test pattern detection for code changes (churn/growth/cleanup)."""

    def setUp(self):
        """Import the module and get PatternDetector class."""
        try:
            module = import_module_from_path(SCRIPT_PATH)
            if module is None:
                self.skipTest("Module not yet implemented (TDD)")
            # Try to get PatternDetector - will fail initially (TDD)
            self.detector = module.PatternDetector()
        except (ImportError, AttributeError):
            self.skipTest("PatternDetector not yet implemented (TDD)")

    def test_detect_heavy_refactor_pattern(self):
        """Test detection of heavy refactoring (high additions + high deletions)."""
        # Heavy refactor: deletions/additions > 0.8
        result = self.detector.detect_pattern(1000, 900)  # 90% ratio
        self.assertEqual(result, 'churn')

        # Test with exact threshold
        result = self.detector.detect_pattern(1000, 800)  # 80% ratio
        self.assertEqual(result, 'churn')

    def test_detect_growth_pattern(self):
        """Test detection of growth pattern (mostly additions)."""
        # Growth: additions/(additions+deletions) > 0.7
        result = self.detector.detect_pattern(900, 100)  # 90% additions
        self.assertEqual(result, 'growth')

        # Test with exact threshold
        result = self.detector.detect_pattern(700, 300)  # 70% additions
        self.assertEqual(result, 'growth')

    def test_detect_cleanup_pattern(self):
        """Test detection of cleanup pattern (mostly deletions)."""
        # Cleanup: deletions/(additions+deletions) > 0.7
        result = self.detector.detect_pattern(100, 900)  # 90% deletions
        self.assertEqual(result, 'cleanup')

        # Test with exact threshold
        result = self.detector.detect_pattern(300, 700)  # 70% deletions
        self.assertEqual(result, 'cleanup')

    def test_detect_normal_pattern(self):
        """Test detection of normal pattern (balanced changes)."""
        # Normal: doesn't match other patterns
        result = self.detector.detect_pattern(500, 400)  # Balanced
        self.assertEqual(result, 'normal')

        result = self.detector.detect_pattern(600, 500)  # Slight addition bias
        self.assertEqual(result, 'normal')

    def test_edge_cases(self):
        """Test edge cases in pattern detection."""
        # All additions, no deletions
        result = self.detector.detect_pattern(1000, 0)
        self.assertEqual(result, 'growth')

        # All deletions, no additions
        result = self.detector.detect_pattern(0, 1000)
        self.assertEqual(result, 'cleanup')

        # No changes at all
        result = self.detector.detect_pattern(0, 0)
        self.assertEqual(result, 'normal')

        # Very small changes
        result = self.detector.detect_pattern(1, 1)
        self.assertEqual(result, 'normal')

    def test_get_pattern_indicator(self):
        """Test getting emoji indicators for patterns."""
        self.assertEqual(self.detector.get_pattern_indicator('churn'), '⚡')
        self.assertEqual(self.detector.get_pattern_indicator('growth'), '📈')
        self.assertEqual(self.detector.get_pattern_indicator('cleanup'), '📉')
        self.assertEqual(self.detector.get_pattern_indicator('normal'), '')

        # Unknown pattern should return empty
        self.assertEqual(self.detector.get_pattern_indicator('unknown'), '')


class TestEnhancedChurnAggregator(unittest.TestCase):
    """Test enhanced aggregation with separate additions/deletions."""

    def setUp(self):
        """Import the module for each test."""
        try:
            module = import_module_from_path(SCRIPT_PATH)
            if module is None:
                self.skipTest("Module not yet implemented (TDD)")
            self.aggregator = module.ChurnAggregator()
        except (ImportError, AttributeError):
            self.skipTest("Module not yet implemented (TDD)")

    def test_aggregate_with_separate_metrics(self):
        """Test aggregating with additions and deletions separated."""
        # Changes now include (namespace, additions, deletions, filepath)
        changes = [
            ('MyCompany.Services', 80, 20, 'Services/UserService.cs'),
            ('MyCompany.Services', 30, 20, 'Services/AuthService.cs'),
            ('MyCompany.Models', 50, 25, 'Models/User.cs'),
            ('(global)', 20, 5, 'GlobalHelper.cs')
        ]

        result = self.aggregator.aggregate_with_details(changes)

        # Check MyCompany.Services aggregation
        self.assertEqual(result['MyCompany.Services']['additions'], 110)  # 80+30
        self.assertEqual(result['MyCompany.Services']['deletions'], 40)   # 20+20
        self.assertEqual(result['MyCompany.Services']['total'], 150)      # 110+40
        self.assertEqual(result['MyCompany.Services']['file_count'], 2)

        # Check MyCompany.Models aggregation
        self.assertEqual(result['MyCompany.Models']['additions'], 50)
        self.assertEqual(result['MyCompany.Models']['deletions'], 25)
        self.assertEqual(result['MyCompany.Models']['total'], 75)

        # Check file details include add/del
        service_files = result['MyCompany.Services']['files']
        self.assertEqual(len(service_files), 2)
        # Files should be sorted by total descending
        self.assertEqual(service_files[0]['additions'], 80)
        self.assertEqual(service_files[0]['deletions'], 20)
        self.assertEqual(service_files[0]['total'], 100)
        self.assertEqual(service_files[0]['path'], 'Services/UserService.cs')


class TestEnhancedFormatting(unittest.TestCase):
    """Test enhanced output formatting with add/del columns."""

    def setUp(self):
        """Import the module for each test."""
        try:
            module = import_module_from_path(SCRIPT_PATH)
            if module is None:
                self.skipTest("Module not yet implemented (TDD)")
            self.formatter = module.OutputFormatter()
            self.console_formatter = module.ConsoleFormatter()
            self.detector = module.PatternDetector()
        except (ImportError, AttributeError):
            self.skipTest("Enhanced formatting not yet implemented (TDD)")

    def test_format_csv_with_separate_columns(self):
        """Test CSV output with additions and deletions columns."""
        data = [
            ('MyCompany.Services', {
                'additions': 500,
                'deletions': 300,
                'total': 800,
                'file_count': 5,
                'pattern': 'normal'
            }),
            ('MyCompany.Models', {
                'additions': 180,
                'deletions': 20,
                'total': 200,
                'file_count': 2,
                'pattern': 'growth'
            })
        ]

        csv_output = self.formatter.format_csv_enhanced(data)

        lines = csv_output.strip().split('\n')
        self.assertEqual(lines[0], 'namespace,added,deleted,total,files,pattern')
        self.assertEqual(lines[1], 'MyCompany.Services,500,300,800,5,normal')
        self.assertEqual(lines[2], 'MyCompany.Models,180,20,200,2,growth')

    def test_format_console_with_separate_columns(self):
        """Test console output with additions and deletions columns."""
        data = [
            ('Heavy.Refactor.NS', {
                'additions': 1200,
                'deletions': 1100,
                'total': 2300,
                'file_count': 10,
                'pattern': 'churn'
            }),
            ('New.Feature.NS', {
                'additions': 980,
                'deletions': 45,
                'total': 1025,
                'file_count': 5,
                'pattern': 'growth'
            }),
            ('Legacy.Cleanup.NS', {
                'additions': 12,
                'deletions': 845,
                'total': 857,
                'file_count': 3,
                'pattern': 'cleanup'
            })
        ]

        output = self.console_formatter.format_enhanced_console(data, show_details=False)

        # Check for pattern indicators
        self.assertIn('⚡', output)  # Heavy refactor
        self.assertIn('📈', output)  # Growth
        self.assertIn('📉', output)  # Cleanup

        # Check for column headers
        self.assertIn('Added', output)
        self.assertIn('Deleted', output)
        self.assertIn('Total', output)

        # Check for values
        self.assertIn('1200', output)  # Additions for refactor
        self.assertIn('1100', output)  # Deletions for refactor
        self.assertIn('980', output)   # Additions for growth
        self.assertIn('45', output)    # Deletions for growth

        # Check for pattern labels in output
        self.assertIn('heavy refactor', output.lower())
        self.assertIn('growth', output.lower())
        self.assertIn('cleanup', output.lower())

    def test_format_file_tree_with_add_del(self):
        """Test file tree formatting with +/- columns."""
        files = [
            {
                'path': 'Controllers/UserController.cs',
                'additions': 150,
                'deletions': 77,
                'total': 227
            },
            {
                'path': 'Controllers/AdminController.cs',
                'additions': 120,
                'deletions': 84,
                'total': 204
            }
        ]

        tree_output = self.console_formatter.format_file_tree_enhanced(files, max_files=2)

        lines = tree_output.strip().split('\n')
        # Check format: ├─ filepath    +150    -77     227
        self.assertIn('+150', lines[0])
        self.assertIn('-77', lines[0])
        self.assertIn('227', lines[0])
        self.assertIn('+120', lines[1])
        self.assertIn('-84', lines[1])

    def test_get_combined_indicator(self):
        """Test combining severity and pattern indicators."""
        # High churn with churn pattern
        indicator = self.formatter.get_combined_indicator(2500, 'churn')
        self.assertIn('🔥', indicator)  # Severity
        self.assertIn('⚡', indicator)  # Pattern

        # Warning level with growth pattern
        indicator = self.formatter.get_combined_indicator(600, 'growth')
        self.assertIn('⚠️', indicator)  # Severity
        self.assertIn('📈', indicator)  # Pattern

        # Normal level with cleanup pattern
        indicator = self.formatter.get_combined_indicator(200, 'cleanup')
        self.assertIn('✓', indicator)   # Severity
        self.assertIn('📉', indicator)  # Pattern


if __name__ == '__main__':
    unittest.main(verbosity=2)