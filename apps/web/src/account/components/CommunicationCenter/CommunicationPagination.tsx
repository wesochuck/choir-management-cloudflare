interface CommunicationPaginationProps {
  readonly disabled?: boolean | undefined;
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
  readonly label?: string | undefined;
  readonly onNextPage: () => void;
  readonly onPreviousPage: () => void;
  readonly pageNumber: number;
}

export function CommunicationPagination({
  disabled = false,
  hasNextPage,
  hasPreviousPage,
  label = "Communication history pagination",
  onNextPage,
  onPreviousPage,
  pageNumber,
}: CommunicationPaginationProps) {
  return (
    <nav aria-label={label} className="communication-pagination">
      <button
        aria-label="Previous page"
        className="button button--secondary button--sm"
        disabled={!hasPreviousPage || disabled}
        onClick={onPreviousPage}
        type="button"
      >
        Previous
      </button>
      <span aria-current="page" className="communication-pagination__page">
        Page {pageNumber}
      </span>
      <button
        aria-label="Next page"
        className="button button--secondary button--sm"
        disabled={!hasNextPage || disabled}
        onClick={onNextPage}
        type="button"
      >
        Next
      </button>
    </nav>
  );
}
