project = "CoAutoResearch"
author = "CoAutoResearch contributors"

extensions = [
    "myst_parser",
    "sphinx_rtd_theme",
    "sphinxcontrib.mermaid",
]

source_suffix = {
    ".rst": "restructuredtext",
    ".md": "markdown",
}
master_doc = "index"
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]

html_theme = "sphinx_rtd_theme"
html_title = "CoAutoResearch"
html_baseurl = "https://yihongt.github.io/CoAutoResearch/"
html_theme_options = {
    "collapse_navigation": False,
    "navigation_depth": 4,
    "sticky_navigation": True,
}
html_context = {
    "display_github": True,
    "github_user": "YihongT",
    "github_repo": "CoAutoResearch",
    "github_version": "main",
    "conf_py_path": "/docs/",
}

myst_enable_extensions = [
    "colon_fence",
    "deflist",
    "fieldlist",
]
