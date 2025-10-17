#!/usr/bin/env python3
"""
Unit tests for dotnet-namespace-churn.py script.
Following TDD principles - tests written before implementation.
"""

import unittest
from unittest.mock import patch, MagicMock, mock_open
import sys
import os
from pathlib import Path
import tempfile
import json
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


class TestNamespaceParser(unittest.TestCase):
    """Test namespace extraction from C# and VB.NET files."""

    def setUp(self):
        """Import the module for each test to ensure clean state."""
        # This will fail initially (TDD) until we create the module
        try:
            module = import_module_from_path(SCRIPT_PATH)
            if module is None:
                self.skipTest("Module not yet implemented (TDD)")
            self.parser = module.NamespaceParser()
        except (ImportError, AttributeError) as e:
            self.skipTest(f"Module not yet implemented (TDD): {e}")

    def test_extract_csharp_traditional_namespace(self):
        """Test extraction of traditional C# namespace syntax."""
        content = """
        using System;

        namespace MyCompany.MyProduct.Features
        {
            public class MyClass
            {
                // class content
            }
        }
        """
        result = self.parser.extract_namespace(content, 'file.cs')
        self.assertEqual(result, 'MyCompany.MyProduct.Features')

    def test_extract_csharp10_file_scoped_namespace(self):
        """Test extraction of C# 10+ file-scoped namespace syntax."""
        content = """
        using System;

        namespace MyCompany.MyProduct.Services;

        public class MyService
        {
            // class content
        }
        """
        result = self.parser.extract_namespace(content, 'file.cs')
        self.assertEqual(result, 'MyCompany.MyProduct.Services')

    def test_extract_vbnet_namespace(self):
        """Test extraction of VB.NET namespace."""
        content = """
        Imports System

        Namespace MyCompany.MyProduct.Utilities
            Public Class Helper
                ' class content
            End Class
        End Namespace
        """
        result = self.parser.extract_namespace(content, 'file.vb')
        self.assertEqual(result, 'MyCompany.MyProduct.Utilities')

    def test_no_namespace_returns_global(self):
        """Test that files without namespace return '(global)'."""
        content = """
        using System;

        public class GlobalClass
        {
            // class content
        }
        """
        result = self.parser.extract_namespace(content, 'file.cs')
        self.assertEqual(result, '(global)')

    def test_nested_namespaces_returns_outermost(self):
        """Test that nested namespaces return the outermost one."""
        content = """
        namespace Outer.Namespace
        {
            namespace Inner
            {
                public class MyClass { }
            }
        }
        """
        result = self.parser.extract_namespace(content, 'file.cs')
        self.assertEqual(result, 'Outer.Namespace')

    def test_empty_file_returns_global(self):
        """Test that empty files return '(global)'."""
        result = self.parser.extract_namespace('', 'file.cs')
        self.assertEqual(result, '(global)')

    def test_commented_namespace_ignored(self):
        """Test that commented namespaces are ignored."""
        content = """
        // namespace Commented.Out
        /* namespace Also.Commented */

        namespace Real.Namespace
        {
            public class MyClass { }
        }
        """
        result = self.parser.extract_namespace(content, 'file.cs')
        self.assertEqual(result, 'Real.Namespace')


class TestGitLogParser(unittest.TestCase):
    """Test git log output parsing and aggregation."""

    def setUp(self):
        """Import the module for each test."""
        try:
            module = import_module_from_path(SCRIPT_PATH)
            if module is None:
                self.skipTest("Module not yet implemented (TDD)")
            self.git_parser = module.GitLogParser()
        except (ImportError, AttributeError):
            self.skipTest("Module not yet implemented (TDD)")

    def test_parse_git_log_line(self):
        """Test parsing single git log numstat line."""
        line = "45\t23\tapp/services/UserService.cs"
        added, deleted, filepath = self.git_parser.parse_numstat_line(line)
        self.assertEqual(added, 45)
        self.assertEqual(deleted, 23)
        self.assertEqual(filepath, 'app/services/UserService.cs')

    def test_parse_binary_file_line(self):
        """Test parsing binary file lines (should be ignored)."""
        line = "-\t-\tapp/resources/icon.png"
        result = self.git_parser.parse_numstat_line(line)
        self.assertIsNone(result)

    def test_filter_dotnet_files_only(self):
        """Test that only .cs and .vb files are processed."""
        lines = [
            "10\t5\tapp/service.cs",
            "20\t10\tapp/helper.vb",
            "30\t15\tapp/config.json",
            "40\t20\tapp/script.js"
        ]
        results = []
        for line in lines:
            parsed = self.git_parser.parse_numstat_line(line)
            if parsed and self.git_parser.is_dotnet_file(parsed[2]):
                results.append(parsed)

        self.assertEqual(len(results), 2)
        self.assertEqual(results[0][2], 'app/service.cs')
        self.assertEqual(results[1][2], 'app/helper.vb')


class TestChurnAggregator(unittest.TestCase):
    """Test churn aggregation by namespace."""

    def setUp(self):
        """Import the module for each test."""
        try:
            module = import_module_from_path(SCRIPT_PATH)
            if module is None:
                self.skipTest("Module not yet implemented (TDD)")
            self.aggregator = module.ChurnAggregator()
        except (ImportError, AttributeError):
            self.skipTest("Module not yet implemented (TDD)")

    def test_aggregate_by_namespace(self):
        """Test aggregating changes by namespace."""
        changes = [
            ('MyCompany.Services', 100, 'Services/UserService.cs'),
            ('MyCompany.Services', 50, 'Services/AuthService.cs'),
            ('MyCompany.Models', 75, 'Models/User.cs'),
            ('(global)', 25, 'GlobalHelper.cs')
        ]

        result = self.aggregator.aggregate(changes)

        self.assertEqual(result['MyCompany.Services']['lines_changed'], 150)
        self.assertEqual(result['MyCompany.Services']['file_count'], 2)
        self.assertEqual(result['MyCompany.Models']['lines_changed'], 75)
        self.assertEqual(result['MyCompany.Models']['file_count'], 1)
        self.assertEqual(result['(global)']['lines_changed'], 25)

        # Check file details are stored and sorted
        self.assertEqual(len(result['MyCompany.Services']['files']), 2)
        # Should be sorted by lines descending
        self.assertEqual(result['MyCompany.Services']['files'][0]['lines'], 100)
        self.assertEqual(result['MyCompany.Services']['files'][0]['path'], 'Services/UserService.cs')
        self.assertEqual(result['MyCompany.Services']['files'][1]['lines'], 50)

    def test_sort_by_churn_descending(self):
        """Test sorting namespaces by total churn (highest first)."""
        aggregated = {
            'Small.Namespace': {'lines_changed': 50, 'file_count': 1},
            'Large.Namespace': {'lines_changed': 500, 'file_count': 5},
            'Medium.Namespace': {'lines_changed': 200, 'file_count': 3}
        }

        sorted_result = self.aggregator.sort_by_churn(aggregated)

        self.assertEqual(sorted_result[0][0], 'Large.Namespace')
        self.assertEqual(sorted_result[1][0], 'Medium.Namespace')
        self.assertEqual(sorted_result[2][0], 'Small.Namespace')

    def test_filter_by_threshold(self):
        """Test filtering namespaces by minimum churn threshold."""
        aggregated = {
            'Above.Threshold': {'lines_changed': 150, 'file_count': 2},
            'Below.Threshold': {'lines_changed': 50, 'file_count': 1},
            'At.Threshold': {'lines_changed': 100, 'file_count': 1}
        }

        filtered = self.aggregator.filter_by_threshold(aggregated, 100)

        self.assertIn('Above.Threshold', filtered)
        self.assertIn('At.Threshold', filtered)
        self.assertNotIn('Below.Threshold', filtered)


class TestGitCommandBuilder(unittest.TestCase):
    """Test git command construction."""

    def setUp(self):
        """Import the module for each test."""
        try:
            module = import_module_from_path(SCRIPT_PATH)
            if module is None:
                self.skipTest("Module not yet implemented (TDD)")
            self.builder = module.GitCommandBuilder()
        except (ImportError, AttributeError):
            self.skipTest("Module not yet implemented (TDD)")

    def test_build_command_for_parent_repo(self):
        """Test building git log command for parent repository."""
        cmd = self.builder.build_log_command('1 month')

        self.assertIn('git log', cmd)
        self.assertIn('--since="1 month"', cmd)
        self.assertIn('--numstat', cmd)
        self.assertIn("--pretty=format:''", cmd)

    def test_build_command_with_pathspecs(self):
        """Test building command with .cs and .vb pathspecs."""
        cmd = self.builder.build_log_command('3 months')

        # Should include pathspecs for .cs and .vb files
        self.assertIn('*.cs', cmd)
        self.assertIn('*.vb', cmd)

    def test_build_command_for_submodule(self):
        """Test building git log command for submodule."""
        cmd = self.builder.build_log_command('1 year', submodule_path='libs/shared')

        self.assertIn('git -C libs/shared log', cmd)
        self.assertIn('--since="1 year"', cmd)

    def test_validate_time_period(self):
        """Test time period validation."""
        valid_periods = ['1 month', '3 months', '1 year']
        for period in valid_periods:
            self.assertTrue(self.builder.is_valid_period(period))

        invalid_periods = ['2 weeks', 'invalid', '']
        for period in invalid_periods:
            self.assertFalse(self.builder.is_valid_period(period))


class TestOutputFormatter(unittest.TestCase):
    """Test output formatting (CSV and console)."""

    def setUp(self):
        """Import the module for each test."""
        try:
            module = import_module_from_path(SCRIPT_PATH)
            if module is None:
                self.skipTest("Module not yet implemented (TDD)")
            self.formatter = module.OutputFormatter()
            # For new ConsoleFormatter class
            try:
                self.console_formatter = module.ConsoleFormatter()
            except AttributeError:
                self.console_formatter = None
        except (ImportError, AttributeError):
            self.skipTest("Module not yet implemented (TDD)")

    def test_format_as_csv(self):
        """Test CSV output formatting."""
        data = [
            ('MyCompany.Services', {'lines_changed': 500, 'file_count': 5}),
            ('MyCompany.Models', {'lines_changed': 200, 'file_count': 2})
        ]

        csv_output = self.formatter.format_csv(data)

        lines = csv_output.strip().split('\n')
        self.assertEqual(lines[0], 'namespace,lines_changed,file_count')
        self.assertEqual(lines[1], 'MyCompany.Services,500,5')
        self.assertEqual(lines[2], 'MyCompany.Models,200,2')

    def test_format_console_with_indicators(self):
        """Test console output with churn indicators."""
        data = [
            ('Hotspot.Namespace', {'lines_changed': 1500, 'file_count': 10}),
            ('Warning.Namespace', {'lines_changed': 600, 'file_count': 5}),
            ('Normal.Namespace', {'lines_changed': 150, 'file_count': 2})
        ]

        output = self.formatter.format_console(data)

        # Check for indicators
        self.assertIn('🔥', output)  # Hotspot (>1000)
        self.assertIn('⚠️', output)  # Warning (>500)
        self.assertIn('✓', output)   # Normal (<500)

    def test_get_churn_indicator(self):
        """Test churn level indicator selection."""
        self.assertEqual(self.formatter.get_indicator(1500), '🔥')
        self.assertEqual(self.formatter.get_indicator(600), '⚠️')
        self.assertEqual(self.formatter.get_indicator(150), '✓')

    def test_format_file_tree(self):
        """Test file-level tree rendering for detailed view."""
        if not self.console_formatter:
            self.skipTest("ConsoleFormatter not yet implemented")

        # Enhanced namespace data with file details
        namespace_data = {
            'namespace': 'Bold.Gemini.API.Tests.Controllers',
            'lines_changed': 2836,
            'file_count': 26,
            'files': [
                {'path': 'Controllers/TenantControllerTests.cs', 'lines': 450},
                {'path': 'Controllers/UserControllerTests.cs', 'lines': 380},
                {'path': 'Controllers/LoginControllerTests.cs', 'lines': 290},
                {'path': 'Controllers/AdminControllerTests.cs', 'lines': 200}
            ]
        }

        tree_output = self.console_formatter.format_file_tree(
            namespace_data['files'],
            max_files=3
        )

        # Check tree formatting
        lines = tree_output.strip().split('\n')
        self.assertIn('├─', lines[0])  # First file with branch
        self.assertIn('├─', lines[1])  # Second file with branch
        self.assertIn('└─', lines[2])  # Last shown file with end
        self.assertIn('450', lines[0])  # Line count right-aligned
        self.assertIn('(1 more files)', lines[3])  # Correct count: 4 total - 3 shown = 1

    def test_format_detailed_console(self):
        """Test console output with detailed file breakdown."""
        if not self.console_formatter:
            self.skipTest("ConsoleFormatter not yet implemented")

        data = [
            ('Hotspot.Namespace', {
                'lines_changed': 1500,
                'file_count': 5,
                'files': [
                    {'path': 'Service/ApiService.cs', 'lines': 800},
                    {'path': 'Service/DataService.cs', 'lines': 400},
                    {'path': 'Service/Helper.cs', 'lines': 300}
                ]
            }),
            ('Normal.Namespace', {
                'lines_changed': 150,
                'file_count': 2,
                'files': [
                    {'path': 'Utils/Logger.cs', 'lines': 100},
                    {'path': 'Utils/Config.cs', 'lines': 50}
                ]
            })
        ]

        output = self.console_formatter.format_detailed_console(data)

        # Check namespace entries
        self.assertIn('Hotspot.Namespace', output)
        self.assertIn('1500', output)  # Total lines

        # Check file tree entries
        self.assertIn('├─', output)  # Tree characters
        self.assertIn('└─', output)
        self.assertIn('Service/ApiService.cs', output)
        self.assertIn('800', output)  # File line count


class TestIntegration(unittest.TestCase):
    """Integration tests with mocked subprocess calls."""

    @patch('subprocess.run')
    @patch('builtins.open', new_callable=mock_open, read_data='namespace Test.Namespace;')
    def test_full_pipeline_with_mock_git(self, mock_file, mock_subprocess):
        """Test full pipeline from git log to output."""
        # Mock git log output
        git_output = """10\t5\tapp/services/UserService.cs
20\t10\tapp/services/OrderService.cs
30\t15\tapp/models/User.cs
-\t-\tapp/assets/logo.png
40\t20\tapp/helpers/Helper.vb"""

        mock_subprocess.return_value = MagicMock(
            stdout=git_output,
            stderr='',
            returncode=0
        )

        try:
            module = import_module_from_path(SCRIPT_PATH)
            if module is None:
                self.skipTest("Module not yet implemented (TDD)")
            analyzer = module.NamespaceChurnAnalyzer()

            # Run analysis
            result = analyzer.analyze('1 month', min_threshold=10)

            # Verify subprocess was called with correct command
            mock_subprocess.assert_called()
            # The command is passed as a single string to shell=True
            call_args_str = str(mock_subprocess.call_args)
            self.assertIn('git log', call_args_str)
            self.assertIn('--numstat', call_args_str)

            # Verify results
            self.assertIsNotNone(result)
            self.assertIn('Test.Namespace', result)

        except (ImportError, AttributeError):
            self.skipTest("Module not yet implemented (TDD)")

    @patch('subprocess.run')
    def test_handle_git_command_failure(self, mock_subprocess):
        """Test graceful handling of git command failures."""
        mock_subprocess.return_value = MagicMock(
            stdout='',
            stderr='fatal: not a git repository',
            returncode=128
        )

        try:
            module = import_module_from_path(SCRIPT_PATH)
            if module is None:
                self.skipTest("Module not yet implemented (TDD)")
            analyzer = module.NamespaceChurnAnalyzer()

            with self.assertRaises(RuntimeError) as context:
                analyzer.analyze('1 month')

            self.assertIn('git', str(context.exception).lower())

        except (ImportError, AttributeError):
            self.skipTest("Module not yet implemented (TDD)")


class TestAuthorshipAnalyzer(unittest.TestCase):
    """Test authorship analysis for namespace ownership."""

    def setUp(self):
        """Import the module for each test."""
        try:
            module = import_module_from_path(SCRIPT_PATH)
            if module is None:
                self.skipTest("Module not yet implemented (TDD)")
            try:
                self.authorship_analyzer = module.AuthorshipAnalyzer()
            except AttributeError:
                self.skipTest("AuthorshipAnalyzer not yet implemented")
        except (ImportError, AttributeError):
            self.skipTest("Module not yet implemented (TDD)")

    @patch('subprocess.run')
    def test_parse_git_log_with_author(self, mock_subprocess):
        """Test parsing git log with author information."""
        # Git log format: author name, then numstat
        git_output = """john.doe@example.com
10\t5\tapp/services/UserService.cs
20\t10\tapp/services/OrderService.cs
jane.smith@example.com
30\t15\tapp/models/User.cs
john.doe@example.com
40\t20\tapp/helpers/Helper.cs"""

        mock_subprocess.return_value = MagicMock(
            stdout=git_output,
            stderr='',
            returncode=0
        )

        result = self.authorship_analyzer.get_author_changes('1 month')

        # Check structure
        self.assertIn('john.doe@example.com', result)
        self.assertIn('jane.smith@example.com', result)

        # Check aggregation
        john_changes = result['john.doe@example.com']
        self.assertEqual(len(john_changes), 3)  # 3 files
        jane_changes = result['jane.smith@example.com']
        self.assertEqual(len(jane_changes), 1)  # 1 file

    def test_calculate_namespace_ownership(self):
        """Test calculating primary ownership per namespace."""
        # Mock author changes by file
        author_changes = {
            'john.doe@example.com': [
                ('Bold.API', 'Controllers/UserController.cs', 100),
                ('Bold.API', 'Controllers/AdminController.cs', 200),
                ('Bold.Models', 'Models/User.cs', 50)
            ],
            'jane.smith@example.com': [
                ('Bold.API', 'Controllers/TestController.cs', 50),
                ('Bold.Models', 'Models/Product.cs', 300)
            ]
        }

        ownership = self.authorship_analyzer.calculate_ownership(author_changes)

        # Check Bold.API ownership (john: 300, jane: 50)
        self.assertEqual(ownership['Bold.API']['primary_author'], 'john.doe@example.com')
        self.assertEqual(ownership['Bold.API']['primary_lines'], 300)
        self.assertEqual(ownership['Bold.API']['total_lines'], 350)
        self.assertAlmostEqual(ownership['Bold.API']['ownership_percent'], 85.7, places=1)

        # Check Bold.Models ownership (john: 50, jane: 300)
        self.assertEqual(ownership['Bold.Models']['primary_author'], 'jane.smith@example.com')
        self.assertEqual(ownership['Bold.Models']['primary_lines'], 300)
        self.assertEqual(ownership['Bold.Models']['total_lines'], 350)
        self.assertAlmostEqual(ownership['Bold.Models']['ownership_percent'], 85.7, places=1)

    def test_format_ownership_report(self):
        """Test formatting the authorship ownership report."""
        ownership_data = {
            'Bold.API': {
                'primary_author': 'john.doe@example.com',
                'primary_lines': 1700,
                'total_lines': 2833,
                'ownership_percent': 60.0
            },
            'AlarmManagement.Customer': {
                'primary_author': 'john.doe@example.com',
                'primary_lines': 102,
                'total_lines': 255,
                'ownership_percent': 40.0
            },
            'Winsock2025': {
                'primary_author': 'jane.smith@example.com',
                'primary_lines': 961,
                'total_lines': 1201,
                'ownership_percent': 80.0
            }
        }

        report = self.authorship_analyzer.format_ownership_report(ownership_data)

        # Check report structure
        self.assertIn('Namespace Ownership by Author', report)
        self.assertIn('john.doe@example.com', report)
        self.assertIn('jane.smith@example.com', report)
        self.assertIn('Bold.API', report)
        self.assertIn('(60%)', report)
        self.assertIn('1700', report)


class TestSubmoduleHandling(unittest.TestCase):
    """Test handling of git submodules."""

    @patch('subprocess.run')
    @patch('os.path.exists')
    def test_detect_submodules(self, mock_exists, mock_subprocess):
        """Test detection of git submodules."""
        mock_exists.return_value = True

        # Mock git config output (actual format: "submodule.name.path value")
        gitmodules_output = """submodule.libs/shared.path libs/shared
submodule.tools/build.path tools/build"""

        mock_subprocess.return_value = MagicMock(
            stdout=gitmodules_output,
            returncode=0
        )

        try:
            module = import_module_from_path(SCRIPT_PATH)
            if module is None:
                self.skipTest("Module not yet implemented (TDD)")
            detector = module.SubmoduleDetector()

            submodules = detector.get_submodules()

            # The mock splits lines by \n, each line has format "key value"
            # Our parser should extract just the paths
            self.assertEqual(len(submodules), 2)
            self.assertIn('libs/shared', submodules)
            self.assertIn('tools/build', submodules)

        except (ImportError, AttributeError):
            self.skipTest("Module not yet implemented (TDD)")

    @patch('subprocess.run')
    @patch('os.path.isdir')
    def test_analyze_submodule(self, mock_isdir, mock_subprocess):
        """Test analyzing code churn in a submodule."""
        mock_isdir.return_value = True

        # First call: check if it's a git repo (success)
        # Second call: get git log from submodule
        mock_subprocess.side_effect = [
            MagicMock(returncode=0),  # git rev-parse
            MagicMock(  # git log
                stdout="25\t10\tSrc/Services/ApiService.cs",
                returncode=0
            )
        ]

        try:
            module = import_module_from_path(SCRIPT_PATH)
            if module is None:
                self.skipTest("Module not yet implemented (TDD)")
            analyzer = module.SubmoduleAnalyzer()

            result = analyzer.analyze_submodule('libs/shared', '1 month')

            self.assertIsNotNone(result)
            # Verify git -C was used for submodule
            calls = mock_subprocess.call_args_list
            self.assertTrue(any('git -C libs/shared' in ' '.join(call[0][0])
                              for call in calls))

        except (ImportError, AttributeError):
            self.skipTest("Module not yet implemented (TDD)")


if __name__ == '__main__':
    unittest.main(verbosity=2)