# Local Log Analysis Tool (LogAnalyzer) - Design Document

## 1. Description
A desktop-based tool to parse local log files, extract specific metrics based on keywords or regular expressions, and visualize them using interactive charts.

## 2. Advanced Features (Redesigned)
- **Session/Boot Management**: 
    - Automatically split a single log file into multiple "Sessions" or "Boots" based on a reset keyword (e.g., `--- Boot ---` or `System Start`).
    - UI to toggle between different boot cycles to compare memory usage between resets.
- **Log Level Multi-indexing**:
    - Automatic detection of `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`.
    - Multi-select filtering in the UI.
- **Flexible Parsing (The "Embedded Log" Problem)**: 
    - Support user-defined Regex for both **Timestamps** and **Key Metrics**.
    - Live preview of parsing results to adjust patterns on the fly.
- **Metric Extraction**: 
    - Pattern matching (e.g., `Memory: (\d+)MB`).
    - Frequency counting (e.g., counting "Error" occurrences).
- **Persistent Profiles**:
    - Save/Load Regex "Profiles" for different products or log formats.

## 3. Technology Stack
- **Languages**: Python (versatile for data processing).
- **UI Framework**: [Streamlit](https://streamlit.io/) (Fastest way to build data UIs).
- **Data Engine**: [Pandas](https://pandas.pydata.org/) for data manipulation.
- **Charts**: [Plotly](https://plotly.com/python/) for interactive visualizations.

## 4. UI Layout Overview
1. **Sidebar (Navigation & Controls)**:
    - **File/Profile**: Quick load of logs and regex presets.
    - **Session Selector**: Multi-select or dropdown for different "Boots".
    - **Global Filter**: Log level toggles and search keywords.
2. **Main Panel (Multi-Tab UI)**:
    - **Overview**: Summary cards (Uptime, max memory, error count per boot).
    - **Analytics**: Plotly line charts for metrics across select boots.
    - **Inspector**: Highlighting log viewer where colors represent levels.

## 5. Workflow
1. User uploads a log file.
2. User provides a keyword/regex (e.g. `mem_used=(\d+)`).
3. Tool scans the file, extracts timestamps and the captured values.
4. Tool renders a line graph showing the value changes over time.
5. User can filter by time or re-run with different keywords.
