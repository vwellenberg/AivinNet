"""
Recipes build the rows of the homepage.
"""

from abc import ABC, abstractmethod
from typing import Any, List


class HomepageRoutine(ABC):
    """
    A routine creates a row of homepage items.

    Two things to know before debugging a row that is not there:

    1. Routines run at STARTUP as well as on their interval — `start_cron_jobs()`
       calls `schedule.run_all()` once everything is registered. A missing row is
       therefore never explained by "the timer has not elapsed yet".
    2. A routine that produces nothing usually returns early and leaves the store
       untouched. That is deliberate (better stale than blank), but it makes an
       empty result look identical to a routine that never ran. **If you add such
       an early return, log it** — otherwise the next person reads the scheduler
       instead of the actual cause. That misreading cost a full diagnosis once.
    """

    @property
    @abstractmethod
    def is_valid(self) -> bool: ...

    def __init__(self) -> None:
        if not self.is_valid:
            return

        self.run()

    @abstractmethod
    def run(self) -> list[Any]:
        """
        Creates the homepage items and saves them to the
        homepage store if self.is_valid is true.
        """
        ...
