#!/usr/bin/env python3
"""
.NET Namespace-Level Code Churn Analyzer

Analyzes code churn at the namespace level for C# and VB.NET projects.
Helps identify architectural hotspots by aggregating changes by namespace.

SOLID Principles Applied:
- S: Each class has single responsibility
- O: Classes open for extension via inheritance
- L: Subclasses can replace base classes
- I: Small, focused interfaces
- D: Depend on abstractions (protocols/base classes)
"""

import argparse
import csv
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple


class NamespaceParser:
    """Extracts namespace declarations from .NET source files."""

    # Regex patterns for namespace extraction
    CSHARP_TRADITIONAL = re.compile(
        r'^\s*namespace\s+([\w\.]+)\s*\{',
        re.MULTILINE
    )
    CSHARP_FILE_SCOPED = re.compile(
        r'^\s*namespace\s+([\w\.]+)\s*;',
        re.MULTILINE
    )
    VBNET_NAMESPACE = re.compile(
        r'^\s*Namespace\s+([\w\.]+)',
        re.MULTILINE | re.IGNORECASE
    )

    def extract_namespace(
        self,
        content: str,
        filepath: str
    ) -> str:
        """
        Extract namespace from file content.

        Args:
            content: Source file content
            filepath: Path to file (for extension detection)

        Returns:
            Namespace string or '(global)' if none found
        """
        if not content.strip():
            return '(global)'

        # Remove comments to avoid false matches
        content = self._remove_comments(content, filepath)

        if filepath.endswith('.cs'):
            return self._extract_csharp_namespace(content)
        elif filepath.endswith('.vb'):
            return self._extract_vbnet_namespace(content)

        return '(global)'

    def _remove_comments(
        self,
        content: str,
        filepath: str
    ) -> str:
        """Remove single and multi-line comments."""
        if filepath.endswith('.cs'):
            # Remove single-line comments
            content = re.sub(r'//.*$', '', content, flags=re.MULTILINE)
            # Remove multi-line comments
            content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
        elif filepath.endswith('.vb'):
            # Remove VB.NET comments
            content = re.sub(r"'.*$", '', content, flags=re.MULTILINE)

        return content

    def _extract_csharp_namespace(self, content: str) -> str:
        """Extract namespace from C# content."""
        # Try file-scoped namespace first (C# 10+)
        match = self.CSHARP_FILE_SCOPED.search(content)
        if match:
            return match.group(1)

        # Try traditional namespace
        match = self.CSHARP_TRADITIONAL.search(content)
        if match:
            return match.group(1)

        return '(global)'

    def _extract_vbnet_namespace(self, content: str) -> str:
        """Extract namespace from VB.NET content."""
        match = self.VBNET_NAMESPACE.search(content)
        if match:
            return match.group(1)

        return '(global)'


class GitLogParser:
    """Parses git log numstat output."""

    def parse_numstat_line(
        self,
        line: str
    ) -> Optional[Tuple[int, int, str]]:
        """
        Parse a git numstat line.

        Args:
            line: Git numstat line (e.g., "10\t5\tfile.cs")

        Returns:
            Tuple of (added, deleted, filepath) or None for binary
        """
        parts = line.strip().split('\t')
        if len(parts) != 3:
            return None

        added, deleted, filepath = parts

        # Skip binary files
        if added == '-' or deleted == '-':
            return None

        try:
            return (int(added), int(deleted), filepath)
        except ValueError:
            return None

    def is_dotnet_file(self, filepath: str) -> bool:
        """Check if file is a .NET source file."""
        return filepath.endswith('.cs') or filepath.endswith('.vb')


class PatternDetector:
    """Detects change patterns (churn, growth, cleanup) from add/del metrics."""

    def detect_pattern(self, additions: int, deletions: int) -> str:
        """
        Detect the pattern of changes based on additions and deletions.

        Args:
            additions: Number of lines added
            deletions: Number of lines deleted

        Returns:
            Pattern type: 'churn', 'growth', 'cleanup', or 'normal'
        """
        total = additions + deletions
        if total == 0:
            return 'normal'

        additions_ratio = additions / total
        deletions_ratio = deletions / total

        # Growth pattern: additions/(total) >= 0.7
        if additions_ratio >= 0.7:
            return 'growth'

        # Cleanup pattern: deletions/(total) >= 0.7
        if deletions_ratio >= 0.7:
            return 'cleanup'

        # Heavy refactor/churn: both additions and deletions are significant
        # AND they are roughly balanced (within 20% of each other)
        # This indicates back-and-forth changes (refactoring)
        # Require both to be substantial (> 600 lines each) to avoid false positives
        if (additions > 600 and deletions > 600 and
            deletions >= additions * 0.8 and
            additions >= deletions * 0.8):
            return 'churn'

        return 'normal'

    def get_pattern_indicator(self, pattern: str) -> str:
        """
        Get emoji indicator for a pattern.

        Args:
            pattern: Pattern type

        Returns:
            Emoji indicator string
        """
        indicators = {
            'churn': '⚡',
            'growth': '📈',
            'cleanup': '📉',
            'normal': ''
        }
        return indicators.get(pattern, '')


class ChurnAggregator:
    """Aggregates code churn by namespace."""

    def __init__(self):
        self.pattern_detector = PatternDetector()

    def aggregate(
        self,
        changes: List[Tuple[str, int, str]]
    ) -> Dict[str, Dict]:
        """
        Aggregate changes by namespace with file details.
        Legacy method for backward compatibility.

        Args:
            changes: List of (namespace, lines_changed, filepath) tuples

        Returns:
            Dict mapping namespace to metrics including file details
        """
        result = {}

        for namespace, lines, filepath in changes:
            if namespace not in result:
                result[namespace] = {
                    'lines_changed': 0,
                    'file_count': 0,
                    'files': []
                }

            result[namespace]['lines_changed'] += lines
            result[namespace]['file_count'] += 1

            # Store file details
            result[namespace]['files'].append({
                'path': filepath,
                'lines': lines
            })

        # Sort files within each namespace by lines (descending)
        for namespace in result:
            result[namespace]['files'].sort(
                key=lambda x: x['lines'],
                reverse=True
            )

        return result

    def aggregate_with_details(
        self,
        changes: List[Tuple[str, int, int, str]]
    ) -> Dict[str, Dict]:
        """
        Aggregate changes by namespace with separated add/del metrics.

        Args:
            changes: List of (namespace, additions, deletions, filepath) tuples

        Returns:
            Dict mapping namespace to enhanced metrics
        """
        result = {}

        for namespace, additions, deletions, filepath in changes:
            if namespace not in result:
                result[namespace] = {
                    'additions': 0,
                    'deletions': 0,
                    'total': 0,
                    'file_count': 0,
                    'files': [],
                    'pattern': 'normal'
                }

            result[namespace]['additions'] += additions
            result[namespace]['deletions'] += deletions
            result[namespace]['total'] += (additions + deletions)
            result[namespace]['file_count'] += 1

            # Store enhanced file details
            result[namespace]['files'].append({
                'path': filepath,
                'additions': additions,
                'deletions': deletions,
                'total': additions + deletions
            })

        # Sort files and detect patterns
        for namespace in result:
            # Sort by total lines (descending)
            result[namespace]['files'].sort(
                key=lambda x: x['total'],
                reverse=True
            )

            # Detect pattern for namespace
            result[namespace]['pattern'] = self.pattern_detector.detect_pattern(
                result[namespace]['additions'],
                result[namespace]['deletions']
            )

        return result

    def sort_by_churn(
        self,
        aggregated: Dict[str, Dict[str, int]]
    ) -> List[Tuple[str, Dict[str, int]]]:
        """Sort namespaces by total churn (descending)."""
        return sorted(
            aggregated.items(),
            key=lambda x: x[1]['lines_changed'],
            reverse=True
        )

    def filter_by_threshold(
        self,
        aggregated: Dict[str, Dict[str, int]],
        min_threshold: int
    ) -> Dict[str, Dict[str, int]]:
        """Filter namespaces by minimum churn threshold."""
        return {
            ns: metrics
            for ns, metrics in aggregated.items()
            if metrics['lines_changed'] >= min_threshold
        }


class GitCommandBuilder:
    """Builds git commands for log analysis."""

    VALID_PERIODS = ['1 month', '3 months', '1 year']

    def build_log_command(
        self,
        period: str,
        submodule_path: Optional[str] = None
    ) -> str:
        """
        Build git log command.

        Args:
            period: Time period (e.g., '1 month')
            submodule_path: Optional path to submodule

        Returns:
            Git command string
        """
        base_cmd = 'git'
        if submodule_path:
            base_cmd = f'git -C {submodule_path}'

        # Build command with pathspecs for .cs and .vb files
        cmd_parts = [
            base_cmd,
            'log',
            f'--since="{period}"',
            '--numstat',
            "--pretty=format:''",
            '--',
            '*.cs',
            '*.vb'
        ]

        return ' '.join(cmd_parts)

    def is_valid_period(self, period: str) -> bool:
        """Validate time period."""
        return period in self.VALID_PERIODS


class SubmoduleDetector:
    """Detects and lists git submodules."""

    def get_submodules(self) -> List[str]:
        """Get list of submodule paths."""
        if not os.path.exists('.gitmodules'):
            return []

        try:
            result = subprocess.run(
                ['git', 'config', '--file', '.gitmodules',
                 '--get-regexp', 'path'],
                capture_output=True,
                text=True,
                check=False
            )

            if result.returncode != 0:
                return []

            submodules = []
            for line in result.stdout.strip().split('\n'):
                if line and line.strip():
                    # Format: submodule.name.path value
                    parts = line.split(maxsplit=1)
                    if len(parts) >= 2:
                        path = parts[1].strip()
                        if path:
                            submodules.append(path)

            return submodules

        except Exception:
            return []


class AuthorshipAnalyzer:
    """Analyzes authorship and namespace ownership."""

    def __init__(self):
        self.namespace_parser = NamespaceParser()
        self.git_parser = GitLogParser()

    def get_author_changes(
        self,
        period: str,
        submodule_path: Optional[str] = None
    ) -> Dict[str, List[Tuple[str, str, int]]]:
        """
        Get code changes grouped by author.

        Args:
            period: Time period for analysis
            submodule_path: Optional path to submodule

        Returns:
            Dict mapping author to list of (namespace, filepath, lines) tuples
        """
        # Build git command with author info (no pathspecs, filter later)
        base_cmd = 'git'
        if submodule_path:
            base_cmd = f'git -C {submodule_path}'

        cmd_parts = [
            base_cmd,
            'log',
            f'--since="{period}"',
            '--numstat',
            "--format='%aN'"  # Author name
        ]
        cmd = ' '.join(cmd_parts)

        try:
            result = subprocess.run(
                cmd,
                shell=True,
                capture_output=True,
                text=True,
                check=False
            )

            if result.returncode != 0:
                return {}

            author_changes = {}
            current_author = None

            for line in result.stdout.strip().split('\n'):
                if not line.strip():
                    # Empty line, skip
                    continue
                elif '\t' not in line:
                    # This is an author line (no tabs)
                    current_author = line.strip().strip("'")
                    if current_author and current_author not in author_changes:
                        author_changes[current_author] = []
                else:
                    # This is a numstat line (contains tabs)
                    if current_author:
                        parsed = self.git_parser.parse_numstat_line(line)
                        if parsed and self.git_parser.is_dotnet_file(parsed[2]):
                            added, deleted, filepath = parsed

                            # Extract namespace
                            namespace = self._extract_namespace_from_file(
                                filepath,
                                submodule_path
                            )

                            total_changes = added + deleted
                            author_changes[current_author].append(
                                (namespace, filepath, total_changes)
                            )

            return author_changes

        except Exception:
            return {}

    def _extract_namespace_from_file(
        self,
        filepath: str,
        submodule_path: Optional[str] = None
    ) -> str:
        """Extract namespace from a file."""
        full_path = filepath
        if submodule_path:
            full_path = os.path.join(submodule_path, filepath)

        try:
            with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
                return self.namespace_parser.extract_namespace(
                    content,
                    filepath
                )
        except (IOError, OSError):
            return '(global)'

    def calculate_ownership(
        self,
        author_changes: Dict[str, List[Tuple[str, str, int]]]
    ) -> Dict[str, Dict]:
        """
        Calculate primary ownership per namespace.

        Args:
            author_changes: Dict of author -> list of (namespace, file, lines)

        Returns:
            Dict of namespace -> ownership metrics
        """
        # Aggregate lines per namespace per author
        namespace_authors = {}

        for author, changes in author_changes.items():
            for namespace, filepath, lines in changes:
                if namespace not in namespace_authors:
                    namespace_authors[namespace] = {}

                if author not in namespace_authors[namespace]:
                    namespace_authors[namespace][author] = 0

                namespace_authors[namespace][author] += lines

        # Calculate ownership
        ownership = {}

        for namespace, authors in namespace_authors.items():
            total_lines = sum(authors.values())

            # Find primary author (most lines)
            primary_author = max(authors.items(), key=lambda x: x[1])

            ownership[namespace] = {
                'primary_author': primary_author[0],
                'primary_lines': primary_author[1],
                'total_lines': total_lines,
                'ownership_percent': (primary_author[1] / total_lines * 100)
                                    if total_lines > 0 else 0,
                'all_authors': authors
            }

        return ownership

    def format_ownership_report(
        self,
        ownership_data: Dict[str, Dict]
    ) -> str:
        """
        Format ownership report for display.

        Args:
            ownership_data: Dict of namespace -> ownership metrics

        Returns:
            Formatted report string
        """
        lines = []
        lines.append('\n' + '='*60)
        lines.append('Namespace Ownership by Author')
        lines.append('='*60)
        lines.append(
            f"{'Author':<25} {'Primary Namespaces':<25} {'Lines':<10}"
        )
        lines.append('-'*60)

        # Group namespaces by primary author
        author_namespaces = {}

        for namespace, data in ownership_data.items():
            author = data['primary_author']
            if author not in author_namespaces:
                author_namespaces[author] = []

            author_namespaces[author].append({
                'namespace': namespace,
                'lines': data['primary_lines'],
                'percent': data['ownership_percent']
            })

        # Sort authors by total lines contributed
        author_totals = []
        for author, namespaces in author_namespaces.items():
            total_lines = sum(ns['lines'] for ns in namespaces)
            author_totals.append((author, namespaces, total_lines))

        author_totals.sort(key=lambda x: x[2], reverse=True)

        # Format output
        for author, namespaces, total_lines in author_totals:
            # Sort namespaces by lines for this author
            namespaces.sort(key=lambda x: x['lines'], reverse=True)

            # Show top 2 namespaces for each author
            for i, ns in enumerate(namespaces[:2]):
                if i == 0:
                    # First line shows author
                    author_display = author[:24] if len(author) <= 24 else author[:21] + '...'
                    ns_display = f"{ns['namespace'][:20]} ({ns['percent']:.0f}%)"
                    lines.append(
                        f"{author_display:<25} {ns_display:<25} {ns['lines']:<10}"
                    )
                else:
                    # Additional namespaces for same author
                    ns_display = f"{ns['namespace'][:20]} ({ns['percent']:.0f}%)"
                    lines.append(
                        f"{'':25} {ns_display:<25} {ns['lines']:<10}"
                    )

        lines.append('-'*60)
        lines.append('')

        return '\n'.join(lines)


class SubmoduleAnalyzer:
    """Analyzes code churn in submodules."""

    def __init__(self):
        self.command_builder = GitCommandBuilder()

    def analyze_submodule(
        self,
        submodule_path: str,
        period: str
    ) -> Optional[List[Tuple[str, int, int, str]]]:
        """
        Analyze churn in a submodule.

        Returns:
            List of (submodule_path, added, deleted, filepath) tuples
        """
        if not os.path.isdir(submodule_path):
            return None

        # Check if it's a valid git repository
        try:
            subprocess.run(
                ['git', '-C', submodule_path, 'rev-parse', '--git-dir'],
                capture_output=True,
                check=True
            )
        except subprocess.CalledProcessError:
            return None

        # Get git log for submodule
        cmd = self.command_builder.build_log_command(period, submodule_path)

        try:
            result = subprocess.run(
                cmd,
                shell=True,
                capture_output=True,
                text=True,
                check=False
            )

            if result.returncode != 0:
                return None

            results = []
            parser = GitLogParser()

            for line in result.stdout.strip().split('\n'):
                if line:
                    parsed = parser.parse_numstat_line(line)
                    if parsed and parser.is_dotnet_file(parsed[2]):
                        added, deleted, filepath = parsed
                        # Prefix with submodule path
                        full_path = f"{submodule_path}/{filepath}"
                        results.append(
                            (submodule_path, added, deleted, full_path)
                        )

            return results

        except Exception:
            return None


class ConsoleFormatter:
    """Formats console output with enhanced tree rendering."""

    def __init__(self):
        self.pattern_detector = PatternDetector()

    def format_file_tree(
        self,
        files: List[Dict[str, any]],
        max_files: int = 10
    ) -> str:
        """
        Format file list as a tree structure.
        Legacy method for backward compatibility.

        Args:
            files: List of file dicts with 'path' and 'lines' keys
            max_files: Maximum number of files to display

        Returns:
            Formatted tree string
        """
        if not files:
            return ""

        lines = []
        files_to_show = min(len(files), max_files)

        for i, file_info in enumerate(files[:files_to_show]):
            is_last = (i == files_to_show - 1)
            tree_char = '└─' if is_last else '├─'

            # Format with aligned line counts
            path = file_info['path']
            line_count = file_info.get('lines', file_info.get('total', 0))

            # Truncate long paths
            max_path_len = 50
            if len(path) > max_path_len:
                path = '...' + path[-(max_path_len-3):]

            line = f"   {tree_char} {path:<50} {line_count:>6}"
            lines.append(line)

        # Add indicator for remaining files
        remaining = len(files) - files_to_show
        if remaining > 0:
            lines.append(f"   └─ ... ({remaining} more files)")

        return '\n'.join(lines)

    def format_file_tree_enhanced(
        self,
        files: List[Dict[str, any]],
        max_files: int = 10
    ) -> str:
        """
        Format file list as a tree with add/del columns.

        Args:
            files: List of file dicts with add/del/total keys
            max_files: Maximum number of files to display

        Returns:
            Formatted tree string with +/- columns
        """
        if not files:
            return ""

        lines = []
        files_to_show = min(len(files), max_files)

        for i, file_info in enumerate(files[:files_to_show]):
            is_last = (i == files_to_show - 1)
            tree_char = '└─' if is_last else '├─'

            # Format with aligned add/del/total counts
            path = file_info['path']
            additions = file_info.get('additions', 0)
            deletions = file_info.get('deletions', 0)
            total = file_info.get('total', additions + deletions)

            # Truncate long paths
            max_path_len = 40
            if len(path) > max_path_len:
                path = '...' + path[-(max_path_len-3):]

            line = (f"   {tree_char} {path:<40} "
                   f"+{additions:<6} -{deletions:<6} {total:>6}")
            lines.append(line)

        # Add indicator for remaining files
        remaining = len(files) - files_to_show
        if remaining > 0:
            lines.append(f"   └─ ... ({remaining} more files)")

        return '\n'.join(lines)

    def format_detailed_console(
        self,
        data: List[Tuple[str, Dict]],
        show_details: bool = True
    ) -> str:
        """
        Format console output with optional file details.

        Args:
            data: List of (namespace, metrics) tuples
            show_details: Whether to show file breakdown

        Returns:
            Formatted console output
        """
        formatter = OutputFormatter()
        lines = []

        # Header
        lines.append('\n' + '='*60)
        lines.append('Namespace-Level Code Churn Analysis')
        lines.append('='*60)
        lines.append(
            f"{'Indicator':<4} {'Namespace':<40} "
            f"{'Lines':<10} {'Files':<5}"
        )
        lines.append('-'*60)

        for namespace, metrics in data:
            indicator = formatter.get_indicator(metrics.get('lines_changed', metrics.get('total', 0)))
            lines.append(
                f"{indicator:<4} {namespace[:40]:<40} "
                f"{metrics.get('lines_changed', metrics.get('total', 0)):<10} "
                f"{metrics['file_count']:<5}"
            )

            # Add file tree if detailed view is enabled
            if show_details and 'files' in metrics and metrics['files']:
                tree = self.format_file_tree(metrics['files'])
                if tree:
                    lines.append(tree)

        lines.append('-'*60)
        total_key = 'lines_changed' if 'lines_changed' in data[0][1] else 'total'
        lines.append(
            f"Total namespaces: {len(data)} | "
            f"Hotspots (🔥): "
            f"{sum(1 for _, m in data if m.get(total_key, 0) > 1000)} | "
            f"Warnings (⚠️): "
            f"{sum(1 for _, m in data if 500 < m.get(total_key, 0) <= 1000)}"
        )
        lines.append('')

        return '\n'.join(lines)

    def format_enhanced_console(
        self,
        data: List[Tuple[str, Dict]],
        show_details: bool = True
    ) -> str:
        """
        Format console output with add/del columns and pattern indicators.

        Args:
            data: List of (namespace, metrics) tuples with enhanced metrics
            show_details: Whether to show file breakdown

        Returns:
            Formatted console output with pattern analysis
        """
        formatter = OutputFormatter()
        lines = []

        # Header
        lines.append('\n' + '='*80)
        lines.append('Namespace-Level Code Churn Analysis')
        lines.append('='*80)
        lines.append(
            f"{'Indicator':<12} {'Namespace':<35} "
            f"{'Added':>7} {'Deleted':>8} {'Total':>7} {'Files':>6}"
        )
        lines.append('-'*80)

        for namespace, metrics in data:
            # Get both severity and pattern indicators
            severity_indicator = formatter.get_indicator(metrics['total'])
            pattern_indicator = self.pattern_detector.get_pattern_indicator(metrics.get('pattern', 'normal'))

            # Combine indicators
            combined = f"{severity_indicator}{pattern_indicator}"

            # Get pattern label for display
            pattern_label = ''
            if metrics.get('pattern') == 'churn':
                pattern_label = ' (heavy refactor)'
            elif metrics.get('pattern') == 'growth':
                pattern_label = ' (growth)'
            elif metrics.get('pattern') == 'cleanup':
                pattern_label = ' (cleanup)'

            # Truncate namespace if needed
            namespace_display = namespace[:35] if len(namespace) <= 35 else namespace[:32] + '...'

            lines.append(
                f"{combined:<12} {namespace_display:<35} "
                f"{metrics['additions']:>7} {metrics['deletions']:>8} "
                f"{metrics['total']:>7} {metrics['file_count']:>6}{pattern_label}"
            )

            # Add file tree if detailed view is enabled
            if show_details and 'files' in metrics and metrics['files']:
                tree = self.format_file_tree_enhanced(metrics['files'])
                if tree:
                    lines.append(tree)

        lines.append('-'*80)
        lines.append(
            f"Total namespaces: {len(data)} | "
            f"Hotspots (🔥): {sum(1 for _, m in data if m['total'] > 1000)} | "
            f"Warnings (⚠️): {sum(1 for _, m in data if 500 < m['total'] <= 1000)} | "
            f"Churn (⚡): {sum(1 for _, m in data if m.get('pattern') == 'churn')}"
        )
        lines.append('')

        return '\n'.join(lines)


class OutputFormatter:
    """Formats analysis output for display."""

    # Churn thresholds for indicators
    HOTSPOT_THRESHOLD = 1000
    WARNING_THRESHOLD = 500

    def __init__(self):
        self.pattern_detector = PatternDetector()

    def format_csv(
        self,
        data: List[Tuple[str, Dict[str, int]]]
    ) -> str:
        """Format data as CSV. Legacy method for backward compatibility."""
        lines = ['namespace,lines_changed,file_count']

        for namespace, metrics in data:
            total = metrics.get('lines_changed', metrics.get('total', 0))
            lines.append(
                f"{namespace},{total},"
                f"{metrics['file_count']}"
            )

        return '\n'.join(lines)

    def format_csv_enhanced(
        self,
        data: List[Tuple[str, Dict]]
    ) -> str:
        """Format data as CSV with add/del columns and pattern."""
        lines = ['namespace,added,deleted,total,files,pattern']

        for namespace, metrics in data:
            lines.append(
                f"{namespace},{metrics['additions']},"
                f"{metrics['deletions']},{metrics['total']},"
                f"{metrics['file_count']},{metrics.get('pattern', 'normal')}"
            )

        return '\n'.join(lines)

    def format_console(
        self,
        data: List[Tuple[str, Dict[str, int]]]
    ) -> str:
        """Format data for console with colored indicators."""
        lines = []

        # Header
        lines.append('\n' + '='*60)
        lines.append('Namespace-Level Code Churn Analysis')
        lines.append('='*60)
        lines.append(
            f"{'Indicator':<4} {'Namespace':<40} "
            f"{'Lines':<10} {'Files':<5}"
        )
        lines.append('-'*60)

        for namespace, metrics in data:
            indicator = self.get_indicator(metrics['lines_changed'])
            lines.append(
                f"{indicator:<4} {namespace[:40]:<40} "
                f"{metrics['lines_changed']:<10} "
                f"{metrics['file_count']:<5}"
            )

        lines.append('-'*60)
        lines.append(
            f"Total namespaces: {len(data)} | "
            f"Hotspots (🔥): "
            f"{sum(1 for _, m in data if m['lines_changed'] > 1000)} | "
            f"Warnings (⚠️): "
            f"{sum(1 for _, m in data if 500 < m['lines_changed'] <= 1000)}"
        )
        lines.append('')

        return '\n'.join(lines)

    def get_indicator(self, lines_changed: int) -> str:
        """Get churn level indicator."""
        if lines_changed > self.HOTSPOT_THRESHOLD:
            return '🔥'
        elif lines_changed > self.WARNING_THRESHOLD:
            return '⚠️'
        else:
            return '✓'

    def get_combined_indicator(self, total_lines: int, pattern: str) -> str:
        """Get combined severity and pattern indicators."""
        severity = self.get_indicator(total_lines)
        pattern_emoji = self.pattern_detector.get_pattern_indicator(pattern)
        return f"{severity}{pattern_emoji}"


class NamespaceChurnAnalyzer:
    """Main analyzer orchestrating the churn analysis."""

    def __init__(self):
        self.namespace_parser = NamespaceParser()
        self.git_parser = GitLogParser()
        self.aggregator = ChurnAggregator()
        self.command_builder = GitCommandBuilder()
        self.formatter = OutputFormatter()
        self.console_formatter = ConsoleFormatter()
        self.submodule_detector = SubmoduleDetector()
        self.submodule_analyzer = SubmoduleAnalyzer()
        self.authorship_analyzer = AuthorshipAnalyzer()

    def analyze(
        self,
        period: str,
        min_threshold: int = 100,
        output_format: str = 'console',
        show_details: bool = False,
        enhanced: bool = False
    ) -> str:
        """
        Analyze namespace-level code churn.

        Args:
            period: Time period for analysis
            min_threshold: Minimum lines changed to include
            output_format: 'console' or 'csv'
            show_details: Show file-level breakdown (console only)
            enhanced: Use enhanced mode with separate add/del columns

        Returns:
            Formatted output string
        """
        if not self.command_builder.is_valid_period(period):
            raise ValueError(
                f"Invalid period. Use: "
                f"{', '.join(self.command_builder.VALID_PERIODS)}"
            )

        # Collect all changes with file paths
        all_changes = []

        # Analyze parent repository
        parent_changes = self._analyze_repository(period, enhanced=enhanced)
        all_changes.extend(parent_changes)

        # Analyze submodules
        submodules = self.submodule_detector.get_submodules()
        for submodule in submodules:
            sub_changes = self._analyze_submodule_changes(
                submodule,
                period,
                enhanced=enhanced
            )
            all_changes.extend(sub_changes)

        if not all_changes:
            return "No .NET code changes found in the specified period."

        # Aggregate by namespace
        if enhanced:
            # Use enhanced aggregation with separate add/del
            aggregated = self.aggregator.aggregate_with_details(all_changes)

            # Filter by threshold using total
            filtered = {
                ns: metrics
                for ns, metrics in aggregated.items()
                if metrics['total'] >= min_threshold
            }

            if not filtered:
                return (
                    f"No namespaces with ≥{min_threshold} lines changed "
                    f"in the specified period."
                )

            # Sort by total churn
            sorted_data = sorted(
                filtered.items(),
                key=lambda x: x[1]['total'],
                reverse=True
            )

            # Format enhanced output
            if output_format == 'csv':
                output = self.formatter.format_csv_enhanced(sorted_data)
            else:
                output = self.console_formatter.format_enhanced_console(
                    sorted_data,
                    show_details=show_details
                )
        else:
            # Legacy mode
            aggregated = self.aggregator.aggregate(all_changes)

            # Filter by threshold
            filtered = self.aggregator.filter_by_threshold(
                aggregated,
                min_threshold
            )

            if not filtered:
                return (
                    f"No namespaces with ≥{min_threshold} lines changed "
                    f"in the specified period."
                )

            # Sort by churn
            sorted_data = self.aggregator.sort_by_churn(filtered)

            # Format main output
            if output_format == 'csv':
                output = self.formatter.format_csv(sorted_data)
            else:
                if show_details:
                    output = self.console_formatter.format_detailed_console(
                        sorted_data,
                        show_details=True
                    )
                else:
                    output = self.formatter.format_console(sorted_data)

        # Add authorship analysis (always for console, not in enhanced mode)
        if output_format == 'console' and not enhanced:
            all_author_changes = {}

            # Get author changes from parent repo
            parent_author_changes = self.authorship_analyzer.get_author_changes(period)
            for author, changes in parent_author_changes.items():
                if author not in all_author_changes:
                    all_author_changes[author] = []
                all_author_changes[author].extend(changes)

            # Get author changes from submodules
            for submodule in submodules:
                sub_author_changes = self.authorship_analyzer.get_author_changes(
                    period,
                    submodule
                )
                for author, changes in sub_author_changes.items():
                    if author not in all_author_changes:
                        all_author_changes[author] = []
                    all_author_changes[author].extend(changes)

            if all_author_changes:
                ownership = self.authorship_analyzer.calculate_ownership(
                    all_author_changes
                )
                if ownership:
                    ownership_report = self.authorship_analyzer.format_ownership_report(
                        ownership
                    )
                    output += ownership_report

        return output

    def _analyze_repository(
        self,
        period: str,
        submodule_path: Optional[str] = None,
        enhanced: bool = False
    ) -> List[Tuple]:
        """
        Analyze changes in a repository.

        Args:
            period: Time period for analysis
            submodule_path: Optional path to submodule
            enhanced: If True, return (namespace, additions, deletions, filepath)
                     If False, return (namespace, total_lines, filepath) for backward compatibility

        Returns:
            List of tuples with change information
        """
        cmd = self.command_builder.build_log_command(period, submodule_path)

        try:
            result = subprocess.run(
                cmd,
                shell=True,
                capture_output=True,
                text=True,
                check=False
            )

            if result.returncode != 0:
                if 'not a git repository' in result.stderr:
                    raise RuntimeError(
                        "Not a git repository. "
                        "Run from repository root."
                    )
                return []

            changes = []
            for line in result.stdout.strip().split('\n'):
                if not line:
                    continue

                parsed = self.git_parser.parse_numstat_line(line)
                if not parsed:
                    continue

                added, deleted, filepath = parsed
                if not self.git_parser.is_dotnet_file(filepath):
                    continue

                # Read file to extract namespace
                namespace = self._extract_namespace_from_file(
                    filepath,
                    submodule_path
                )

                if enhanced:
                    # Return additions and deletions separately
                    changes.append((namespace, added, deleted, filepath))
                else:
                    # Legacy mode: return total
                    total_changes = added + deleted
                    changes.append((namespace, total_changes, filepath))

            return changes

        except subprocess.SubprocessError as e:
            raise RuntimeError(f"Git command failed: {e}")

    def _analyze_submodule_changes(
        self,
        submodule_path: str,
        period: str,
        enhanced: bool = False
    ) -> List[Tuple]:
        """
        Analyze changes in a submodule.

        Args:
            submodule_path: Path to submodule
            period: Time period for analysis
            enhanced: If True, return enhanced format with separate add/del

        Returns:
            List of change tuples
        """
        results = self.submodule_analyzer.analyze_submodule(
            submodule_path,
            period
        )

        if not results:
            return []

        changes = []
        for _, added, deleted, filepath in results:
            namespace = self._extract_namespace_from_file(
                filepath,
                None  # Full path already includes submodule
            )

            if enhanced:
                # Return additions and deletions separately
                changes.append((namespace, added, deleted, filepath))
            else:
                # Legacy mode: return total
                total_changes = added + deleted
                changes.append((namespace, total_changes, filepath))

        return changes

    def _extract_namespace_from_file(
        self,
        filepath: str,
        submodule_path: Optional[str] = None
    ) -> str:
        """Extract namespace from a file."""
        full_path = filepath
        if submodule_path:
            full_path = os.path.join(submodule_path, filepath)

        try:
            with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
                return self.namespace_parser.extract_namespace(
                    content,
                    filepath
                )
        except (IOError, OSError):
            # File might be deleted or moved
            return '(global)'


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Analyze .NET namespace-level code churn',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --period "1 month"
  %(prog)s --period "3 months" --threshold 200
  %(prog)s --period "1 year" --format csv > churn.csv
  %(prog)s --period "3 months" --detailed
  %(prog)s --period "3 months" --enhanced  # Show additions/deletions separately
        """
    )

    parser.add_argument(
        '--period',
        default='1 month',
        choices=['1 month', '3 months', '1 year'],
        help='Time period for analysis (default: 1 month)'
    )

    parser.add_argument(
        '--threshold',
        type=int,
        default=100,
        help='Minimum lines changed to display (default: 100)'
    )

    parser.add_argument(
        '--format',
        choices=['console', 'csv'],
        default='console',
        help='Output format (default: console)'
    )

    parser.add_argument(
        '--detailed',
        action='store_true',
        help='Show file-level breakdown for each namespace (console only)'
    )

    parser.add_argument(
        '--enhanced',
        action='store_true',
        help='Enhanced mode: show additions and deletions separately with pattern detection'
    )

    args = parser.parse_args()

    # Enhanced mode is always detailed
    if args.enhanced:
        args.detailed = True

    try:
        analyzer = NamespaceChurnAnalyzer()
        output = analyzer.analyze(
            args.period,
            args.threshold,
            args.format,
            args.detailed,
            args.enhanced
        )
        print(output)
        return 0

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())