"""Base exception classes for the Fantasy League API"""


class FantasyAPIError(Exception):
    """Base exception for all Fantasy API errors"""
    pass


class InvalidParameterError(FantasyAPIError):
    """Raised when request parameters are invalid (422)
    
    Examples:
    - Invalid sort column name
    - Invalid order parameter
    - Invalid category name
    """
    pass


class ResourceNotFoundError(FantasyAPIError):
    """Raised when requested resource is not found (404)
    
    Examples:
    - Team ID not found
    - No players for team
    - No data available
    """
    pass


class DataSourceError(FantasyAPIError):
    """Raised when external data source is unavailable (503)
    
    Examples:
    - ESPN API is down
    - Network timeout
    - Invalid API response format
    """
    pass 